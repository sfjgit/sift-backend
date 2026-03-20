import { Router } from "express";
import authRoutes from "./auth.routes";
import userRoutes from "./user.routes";
import roleRoutes from "./role.routes";
import businessUnitRoutes from "./businessUnit.routes";
import teamRoutes from "./team.routes";
import clientRoutes from "./client.routes";
import requirementRoutes from "./requirements.routes";

const router = Router();

router.use("/auth", authRoutes);

router.use("/users", userRoutes);

router.use("/roles", roleRoutes);

router.use("/clients", clientRoutes);

router.use("/business-units", businessUnitRoutes);

// router.use("/teams", teamRoutes);

// router.use("/business-units", businessUnitRoutes);

router.use("/teams", teamRoutes);

router.use("/requirements", requirementRoutes);

export default router;
