// SPDX-License-Identifier: AGPL-3.0-or-later
import { Router, type IRouter } from "express";
import cspReportRouter from "./csp-report";
import healthRouter from "./health";
import iceServersRouter from "./ice-servers";
import paywallRouter from "./paywall";
import proofBuildRouter from "./proof-build";
import provenanceRouter from "./provenance";
import roomStateRouter from "./room-state";
import specRouter from "./spec";

const router: IRouter = Router();

router.use(cspReportRouter);
router.use(healthRouter);
router.use(iceServersRouter);
router.use(paywallRouter);
router.use(proofBuildRouter);
router.use(provenanceRouter);
router.use(roomStateRouter);
router.use(specRouter);

export default router;
