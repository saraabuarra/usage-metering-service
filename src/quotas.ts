import { Router } from "express";
import { requireApiKey } from "./auth.js";

const router = Router();

router.use(requireApiKey);

router.all("/", (_req, res) => {
  res.status(410).json({
    error: "Legacy quota endpoints are retired. Use account and user plans.",
  });
});

router.all("/:userId", (_req, res) => {
  res.status(410).json({
    error: "Legacy quota endpoints are retired. Use account and user plans.",
  });
});

export default router;
