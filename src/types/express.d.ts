// types/express.d.ts
declare global {
  namespace Express {
    interface Request {
      //newly added
      params: ParamsDictionary;
      query: Query;

      validatedBody: any;
      validatedQuery: any;
      validatedParams: any;
      file: any;
      permissionScope: any;
      scopeFilter: any;
      modulePermission: {
        canView: boolean;
        canAdd: boolean;
        canEdit: boolean;
        canDelete: boolean;
        canViewScope: string;
        canAddScope: string;
        canEditScope: string;
        canDeleteScope: string;
      };
      user: {
        id: string;
        email: string;
        passwordHash: string;
        firstName: string;
        lastName: string;
        middleName: string | null;
        nickName: string | null;
        displayName: string | null;
        employeeId: string | null;
        phone: string | null;
        workingLocation: string | null;
        timezone: string | null;
        dateOfBirth: Date | null;
        dateOfJoin: Date | null;
        isSuperAdmin: boolean;
        isActive: boolean;
        roleId: string;
        reportingToId: string | null;
        teamLeadId: string | null;
        departmentId: string | null;
        createdById: string | null;
        createdAt: Date;
        updatedAt: Date;
        role: {
          id: string;
          name: string;
          permissions: {
            module: string;
            canView: boolean;
            canAdd: boolean;
            canEdit: boolean;
            canDelete: boolean;
            canViewScope: string;
            canAddScope: string;
            canEditScope: string;
            canDeleteScope: string;
          }[];
        };
      };
    }
  }
}

export {};
