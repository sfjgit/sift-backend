declare global {
  namespace Express {
    interface Request {
      validatedBody: any;
      validatedQuery: any;
      validatedParams: any;
      file: any;
      permissionScope: any;
      user: {
        id: string;
        isActive: boolean;
        createdById: string | null;
        createdAt: Date;
        updatedAt: Date;
        roleId: string;
        email: string;
        passwordHash: string;
        passwordPlain: string | null;
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
        reportingToId: string | null;
        businessUnitId: string | null;
      };
    }
  }
}

export {};
