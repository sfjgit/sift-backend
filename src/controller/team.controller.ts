import { createAuditLog } from "@/services/auditLogs.service";
import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";

export const createTeam = async(req: Request, res: Response) => {
    try{
        const {name, description, isActive, category, parentTeamId, businessUnitId}=req.validatedBody;
        const existingTeam=await prisma.team.findFirst({
            where:{name}
        })
        if(existingTeam){
            return res.status(400).json({message:"Team already exists"});
        }
        const team=await prisma.team.create({
            data:{name, description, isActive, category, parentTeamId, businessUnitId}
        })
        await createAuditLog({ actorId: req.user.id, action: "CREATE", module: "TEAM", recordId: team.id, oldData: null, newData: team, req });
        return res.status(201).json({success:true, message:"Team created successfully", data:team});
    }catch(error){
        console.error("Error creating team:", error);
        return res.status(500).json({success:false, message:"Error creating team"});
    }
}

