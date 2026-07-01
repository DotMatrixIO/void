// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import {
  TEST_PAYWALL_SECRET,
  useTestServer,
  emitCreateRoom,
  validToken,
  validRoomId,
  connectClient,
} from "./helpers/test-server";

function freshJti(): string {
  return crypto.randomBytes(16).toString("hex");
}

function expiredToken(): string {
  return jwt.sign({ authorized: true, jti: freshJti() }, TEST_PAYWALL_SECRET, { expiresIn: "-1s" });
}

function unauthorizedToken(): string {
  return jwt.sign({ authorized: false, jti: freshJti() }, TEST_PAYWALL_SECRET, { expiresIn: "1h" });
}

function wrongSecretToken(): string {
  const otherSecret = crypto.randomBytes(32).toString("hex");
  return jwt.sign({ authorized: true, jti: freshJti() }, otherSecret, { expiresIn: "1h" });
}

describe("create-room edge cases", () => {
  const { getClient, getPort } = useTestServer();

  describe("invalid tokens → PAYMENT_REQUIRED", () => {
    it("rejects an expired JWT", async () => {
      const result = await emitCreateRoom(getClient(), {
        roomId: validRoomId(),
        token: expiredToken(),
      });
      expect(result).toEqual({ error: "PAYMENT_REQUIRED" });
    });

    it("rejects a JWT signed with the wrong secret", async () => {
      const result = await emitCreateRoom(getClient(), {
        roomId: validRoomId(),
        token: wrongSecretToken(),
      });
      expect(result).toEqual({ error: "PAYMENT_REQUIRED" });
    });

    it("rejects a JWT where authorized is false", async () => {
      const result = await emitCreateRoom(getClient(), {
        roomId: validRoomId(),
        token: unauthorizedToken(),
      });
      expect(result).toEqual({ error: "PAYMENT_REQUIRED" });
    });

    it("rejects a completely garbage token string", async () => {
      const result = await emitCreateRoom(getClient(), {
        roomId: validRoomId(),
        token: "not-a-real-jwt",
      });
      expect(result).toEqual({ error: "PAYMENT_REQUIRED" });
    });

    it("rejects an empty token string", async () => {
      const result = await emitCreateRoom(getClient(), {
        roomId: validRoomId(),
        token: "",
      });
      expect(result).toEqual({ error: "PAYMENT_REQUIRED" });
    });
  });

  describe("duplicate room IDs → ROOM_EXISTS", () => {
    it("rejects creating a room with the same ID twice", async () => {
      const roomId = validRoomId();
      const first = await emitCreateRoom(getClient(), {
        roomId,
        token: validToken(),
      });
      expect(first).toHaveProperty("success", true);

      const second = await emitCreateRoom(getClient(), {
        roomId,
        token: validToken(),
      });
      expect(second).toEqual({ error: "ROOM_EXISTS" });
    });

    it("allows different room IDs after a duplicate rejection", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(getClient(), { roomId, token: validToken() });
      const dup = await emitCreateRoom(getClient(), { roomId, token: validToken() });
      expect(dup).toEqual({ error: "ROOM_EXISTS" });

      const other = await emitCreateRoom(getClient(), {
        roomId: validRoomId(),
        token: validToken(),
      });
      expect(other).toHaveProperty("success", true);
    });
  });

  describe("invalid room ID format → INVALID_ROOM_ID", () => {
    const badIds = [
      { label: "too short", id: "abcdef1234567890" },
      { label: "too long", id: "a".repeat(33) },
      { label: "uppercase hex", id: "ABCDEF1234567890ABCDEF1234567890" },
      { label: "contains non-hex chars", id: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" },
      { label: "contains spaces", id: "abcdef12 4567890abcdef1234567890" },
      { label: "contains dashes", id: "abcdef12-4567890-bcdef123-567890" },
      { label: "empty string", id: "" },
    ];

    for (const { label, id } of badIds) {
      it(`rejects ${label}: "${id}"`, async () => {
        const result = await emitCreateRoom(getClient(), {
          roomId: id,
          token: validToken(),
        });
        expect(result).toEqual({ error: "INVALID_ROOM_ID" });
      });
    }
  });

  describe("rate limiting → RATE_LIMITED", () => {
    it("allows up to 10 create-room calls then returns RATE_LIMITED", async () => {
      const results: Record<string, unknown>[] = [];
      for (let i = 0; i < 12; i++) {
        results.push(
          await emitCreateRoom(getClient(), {
            roomId: validRoomId(),
            token: validToken(),
          }),
        );
      }

      for (let i = 0; i < 10; i++) {
        expect(results[i]).toHaveProperty("success", true);
      }

      expect(results[10]).toEqual({ error: "RATE_LIMITED" });
      expect(results[11]).toEqual({ error: "RATE_LIMITED" });
    });

    it("rate limit is per-socket (different socket is not limited)", async () => {
      for (let i = 0; i < 10; i++) {
        await emitCreateRoom(getClient(), {
          roomId: validRoomId(),
          token: validToken(),
        });
      }

      const limited = await emitCreateRoom(getClient(), {
        roomId: validRoomId(),
        token: validToken(),
      });
      expect(limited).toEqual({ error: "RATE_LIMITED" });

      const client2 = connectClient(getPort());
      await new Promise<void>((resolve) => {
        client2.on("connect", resolve);
      });

      const result = await emitCreateRoom(client2, {
        roomId: validRoomId(),
        token: validToken(),
      });
      expect(result).toHaveProperty("success", true);

      client2.disconnect();
    });
  });
});
