#!/usr/bin/env tsx
// SPDX-License-Identifier: AGPL-3.0-or-later
// Generates TypeScript types from lib/api-spec/asyncapi.yaml.
// Run as part of the codegen script:
//   pnpm --filter @workspace/api-spec run codegen

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Minimal types for the AsyncAPI spec structure we consume
// ---------------------------------------------------------------------------
interface SchemaObject {
  type?: string;
  enum?: string[];
  properties?: Record<string, SchemaObject>;
  required?: string[];
  additionalProperties?: boolean | SchemaObject;
  $ref?: string;
  description?: string;
  oneOf?: SchemaObject[];
  allOf?: SchemaObject[];
  items?: SchemaObject;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  example?: unknown;
  summary?: string;
}

interface MessageObject {
  name?: string;
  title?: string;
  payload?: SchemaObject & { $ref?: string };
}

interface ChannelObject {
  address: string;
  messages?: Record<string, { $ref: string }>;
}

interface OperationObject {
  action: "receive" | "send";
  channel: { $ref: string };
  messages?: { $ref: string }[];
  reply?: {
    address?: unknown;
    messages?: { $ref: string }[];
  };
}

interface AsyncAPISpec {
  channels?: Record<string, ChannelObject>;
  operations?: Record<string, OperationObject>;
  components: {
    schemas: Record<string, SchemaObject>;
    messages?: Record<string, MessageObject>;
  };
}

// ---------------------------------------------------------------------------
// Schema → TypeScript helpers
// ---------------------------------------------------------------------------

function refName(ref: string): string {
  return ref.split("/").pop()!;
}

function schemaToInlineType(schema: SchemaObject): string {
  if (schema.$ref) {
    return refName(schema.$ref);
  }

  if (schema.allOf) {
    const onlyRefs = schema.allOf.filter((s) => s.$ref);
    if (onlyRefs.length === 1 && schema.allOf.length === 1) {
      return refName(onlyRefs[0].$ref!);
    }
    return schema.allOf.map(schemaToInlineType).join(" & ");
  }

  if (schema.oneOf) {
    return schema.oneOf
      .map((s) => (s.type === "null" ? "null" : schemaToInlineType(s)))
      .join(" | ");
  }

  switch (schema.type) {
    case "string":
      return schema.enum
        ? schema.enum.map((v) => `"${v}"`).join(" | ")
        : "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "object": {
      if (!schema.properties || Object.keys(schema.properties).length === 0) {
        return "Record<string, never>";
      }
      const required = new Set(schema.required ?? []);
      const lines = Object.entries(schema.properties).map(([k, v]) => {
        const opt = required.has(k) ? "" : "?";
        return `  ${k}${opt}: ${schemaToInlineType(v)};`;
      });
      return `{\n${lines.join("\n")}\n}`;
    }
    case "array":
      return schema.items ? `${schemaToInlineType(schema.items)}[]` : "unknown[]";
    default:
      return "unknown";
  }
}

function docLine(text: string | undefined): string {
  if (!text) return "";
  const trimmed = text.trim().replace(/\n\s*/g, " ");
  return `/** ${trimmed} */\n`;
}

function generateTopLevel(name: string, schema: SchemaObject): string {
  const doc = docLine(schema.description ?? schema.summary);

  if (schema.type === "string" && schema.enum) {
    const values = schema.enum.map((v) => `"${v}"`).join("\n  | ");
    return `${doc}export type ${name} =\n  | ${values};\n`;
  }

  if (
    schema.type === "string" ||
    schema.type === "integer" ||
    schema.type === "number" ||
    schema.type === "boolean"
  ) {
    return `${doc}export type ${name} = ${schemaToInlineType(schema)};\n`;
  }

  if (
    schema.type === "object" &&
    (!schema.properties || Object.keys(schema.properties).length === 0)
  ) {
    return `${doc}export type ${name} = Record<string, never>;\n`;
  }

  if (schema.type === "object" && schema.properties) {
    const required = new Set(schema.required ?? []);
    const propLines = Object.entries(schema.properties).map(([k, v]) => {
      const opt = required.has(k) ? "" : "?";
      const d = v.description
        ? `  /** ${v.description.trim().replace(/\n\s*/g, " ")} */\n`
        : "";
      return `${d}  ${k}${opt}: ${schemaToInlineType(v)};`;
    });
    return `${doc}export interface ${name} {\n${propLines.join("\n")}\n}\n`;
  }

  return `${doc}export type ${name} = ${schemaToInlineType(schema)};\n`;
}

// ---------------------------------------------------------------------------
// Event map generation from channels + operations
// ---------------------------------------------------------------------------

/**
 * Resolve the payload TypeScript type name from a message $ref.
 * The ref can point to:
 *   - "#/components/messages/FooMessage"
 *   - "#/channels/channelKey/messages/MsgKey" (which indirects to a components/messages ref)
 */
function resolvePayloadType(
  msgRef: string,
  messages: Record<string, MessageObject>,
  channels: Record<string, ChannelObject>,
): string {
  if (msgRef.startsWith("#/components/messages/")) {
    const msgName = msgRef.replace("#/components/messages/", "");
    const msg = messages[msgName];
    if (!msg?.payload) return "unknown";
    if (msg.payload.$ref) return refName(msg.payload.$ref);
    if (msg.payload.type === "null") return "null";
    return schemaToInlineType(msg.payload as SchemaObject);
  }

  if (msgRef.startsWith("#/channels/")) {
    // "#/channels/createRoom/messages/CreateRoomRequest"
    const parts = msgRef.split("/");
    const channelKey = parts[2];
    const msgKey = parts[4];
    const channelMsgEntry = channels[channelKey]?.messages?.[msgKey];
    if (!channelMsgEntry?.$ref) return "unknown";
    return resolvePayloadType(channelMsgEntry.$ref, messages, channels);
  }

  return "unknown";
}

function generateEventMaps(spec: AsyncAPISpec): string {
  const channels = spec.channels ?? {};
  const operations = spec.operations ?? {};
  const messages = spec.components.messages ?? {};

  const serverToClient: string[] = [];
  const clientToServer: string[] = [];

  for (const [, op] of Object.entries(operations)) {
    const channelKey = refName(op.channel.$ref);
    const channel = channels[channelKey];
    if (!channel) continue;

    const eventName = channel.address;

    // Resolve the request payload type from the operation's messages
    let payloadType = "unknown";
    if (op.messages && op.messages.length > 0) {
      payloadType = resolvePayloadType(op.messages[0].$ref, messages, channels);
    }

    if (op.action === "send") {
      // Server → Client
      if (payloadType === "null") {
        serverToClient.push(`  "${eventName}": () => void;`);
      } else {
        serverToClient.push(`  "${eventName}": (data: ${payloadType}) => void;`);
      }
    } else {
      // Client → Server (receive)
      if (op.reply?.messages && op.reply.messages.length > 0) {
        const ackType = resolvePayloadType(op.reply.messages[0].$ref, messages, channels);
        if (payloadType === "null") {
          clientToServer.push(`  "${eventName}": (cb?: (result: ${ackType}) => void) => void;`);
        } else {
          clientToServer.push(
            `  "${eventName}": (data: ${payloadType}, cb?: (result: ${ackType}) => void) => void;`,
          );
        }
      } else {
        if (payloadType === "null") {
          clientToServer.push(`  "${eventName}": () => void;`);
        } else {
          clientToServer.push(`  "${eventName}": (data: ${payloadType}) => void;`);
        }
      }
    }
  }

  return [
    `/**`,
    ` * Typed Socket.IO event maps generated from asyncapi.yaml.`,
    ` *`,
    ` * Usage on the server:`,
    ` *   import { Server } from "socket.io";`,
    ` *   const io = new Server<ClientToServerEvents, ServerToClientEvents>(...);`,
    ` *`,
    ` * Usage on the client:`,
    ` *   import { io } from "socket.io-client";`,
    ` *   const socket = io(...) as Socket<ServerToClientEvents, ClientToServerEvents>;`,
    ` */`,
    ``,
    `/** Events emitted by the server and received by the client. */`,
    `export interface ServerToClientEvents {`,
    ...serverToClient,
    `}`,
    ``,
    `/** Events emitted by the client and received by the server. */`,
    `export interface ClientToServerEvents {`,
    ...clientToServer,
    `}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const specPath = resolve(__dirname, "asyncapi.yaml");
const spec = parse(readFileSync(specPath, "utf8")) as AsyncAPISpec;
const schemas = spec.components.schemas;

const chunks: string[] = [
  "// AUTO-GENERATED — do not edit manually.",
  "// Re-generate with: pnpm --filter @workspace/api-spec run codegen",
  "// Source: lib/api-spec/asyncapi.yaml",
  "",
];

// 1. Payload / schema types
for (const [name, schema] of Object.entries(schemas)) {
  chunks.push(generateTopLevel(name, schema));
}

// 2. Typed Socket.IO event maps
chunks.push(generateEventMaps(spec));

const outDir = resolve(root, "lib", "signaling-types", "src");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "generated.ts");
writeFileSync(outPath, chunks.join("\n"), "utf8");
console.log(`✓ signaling types → ${outPath}`);
