// SPDX-License-Identifier: AGPL-3.0-or-later
import { Router, type IRouter } from "express";
import openApiYaml from "../../../../lib/api-spec/openapi.yaml";
import asyncApiYaml from "../../../../lib/api-spec/asyncapi.yaml";

const router: IRouter = Router();

const YAML_CACHE_HEADER = "public, max-age=3600";

router.get("/openapi.yaml", (_req, res) => {
  res.setHeader("Content-Type", "application/yaml");
  res.setHeader("Cache-Control", YAML_CACHE_HEADER);
  res.send(openApiYaml);
});

router.get("/asyncapi.yaml", (_req, res) => {
  res.setHeader("Content-Type", "application/yaml");
  res.setHeader("Cache-Control", YAML_CACHE_HEADER);
  res.send(asyncApiYaml);
});

export default router;
