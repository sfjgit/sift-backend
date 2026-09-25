-- AddForeignKey
ALTER TABLE "PortalRecruitLog" ADD CONSTRAINT "PortalRecruitLog_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalRecruitLog" ADD CONSTRAINT "PortalRecruitLog_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "RequirementAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
