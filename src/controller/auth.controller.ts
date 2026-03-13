import prisma from "@/utils/prisma/client";
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { generateAccessToken, generateRefreshToken, JWTPayLoad, verifyAccessToken } from "@/utils/jwt";

export const register = async (req:Request, res:Response) => {
    try {
        const {email, password, roleId, firstName, lastName, ...rest} = req.validatedBody;
        const existingUser=await prisma.user.findUnique({
            where:{email},
        })
        if(existingUser){
            return res.status(400).json({message:"User already exists"});
        }
        const roleData=await prisma.role.findUnique({
            where:{id:roleId}
        })
        if(!roleData){
            return res.status(400).json({message:"Role not found"});
        }
        const hashedPassword=await bcrypt.hash(password, 10);
        const user=await prisma.user.create({
            data:{...rest, email, passwordHash:hashedPassword, roleId: roleId, firstName, lastName}
        })
        const {passwordHash, passwordPlain, ...safeUser} = user
        return res.status(201).json({ success: true, message: "User created successfully", data: safeUser });
    }catch (error) {
        console.error("Error creating user:", error);
        return res.status(500).json({ success: false, message: "Error creating user" });
    }
}

export const login =async(req:Request, res:Response) => {
    try{
        const {email, password} = req.validatedBody;
        const user=await prisma.user.findUnique({
            where:{email},
            include:{role:true}
        })
        if(!user){
            return res.status(401).json({message:"Email not found"});
        }
        const isPasswordValid=await bcrypt.compare(password, user.passwordHash);
        if(!isPasswordValid){
            return res.status(401).json({message:"Invalid password"});
        }
        const accessToken=generateAccessToken({userId:user.id, email:user.email, roleId:user.roleId});
        const refreshToken=generateRefreshToken({userId:user.id, email:user.email, roleId:user.roleId});
        await prisma.refreshToken.create({
            data:{
                token:refreshToken,
                userId:user.id, 
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)}
        })
        const {passwordHash, passwordPlain, ...safeUser} = user
        return res.status(200).json({success:true, message:"Login successful", data:safeUser, accessToken:accessToken, refreshToken:refreshToken});
    }catch (error) {
        console.error("Error logging in:", error);
        return res.status(500).json({ success: false, message: "Error logging in" });
    }
}

export const refresh = async (req: Request, res: Response) => {
  try {

    const { refreshToken } = req.validatedBody;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: "Refresh token required",
      });
    }

    const decoded = verifyAccessToken(refreshToken) as JWTPayLoad;

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    const accessToken=generateAccessToken({userId:user.id, email:user.email, roleId:user.roleId});

    return res.status(200).json({
      success: true,
      data: {
        accessToken,
      },
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired refresh token",
    });
  }
};

export const logout = async (req:Request, res:Response) => {
    try {
        const {refreshToken} = req.validatedBody;
        const userId =req.headers['x-user-id'] as string
        await prisma.refreshToken.delete({
            where:{
                token:refreshToken,
                userId:userId
            }
        })
        return res.status(200).json({success:true, message:"Logout successful"});
    } catch (error) {
        console.error("Error logging out:", error);
        return res.status(500).json({ success: false, message: "Error logging out" });
    }
}

export const resetPassword = async (req:Request, res:Response) => {
    try {
        const {userId}=req.validatedParams;
        const {newPassword}=req.validatedBody;
        const user = await prisma.user.findUnique({
            where: { id: userId }
            });

            if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }
        const hashedNewPassword=await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where:{id:userId},
            data:{
                passwordHash:hashedNewPassword
            }
        })
        return res.status(200).json({success:true, message:"Password reset successful"});
    } catch (error) {
        console.error("Error resetting password:", error);
        return res.status(500).json({ success: false, message: "Error resetting password" });
    }
}

export const getUserCredentials = async (req:Request, res:Response) => {
    try{
        const {userId}=req.validatedParams;
        const user=await prisma.user.findUnique({
            where:{id:userId},
            include:{role:true}
        })
        if(!user){
            return res.status(404).json({message:"User not found"});
        }
        return res.status(200).json({success:true, message:"User credentials fetched successfully", data:user});
    }catch(error){
        console.error("Error getting user credentials:", error);
        return res.status(500).json({ success: false, message: "Error getting user credentials" });
    }
}