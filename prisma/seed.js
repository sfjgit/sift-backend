// prisma/seed.js

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding...");

  // ─────────────────────────────────────────
  // ROLES
  // ─────────────────────────────────────────

  const superAdminRole = await prisma.role.upsert({
    where: { name: "Super Admin" },
    update: {},
    create: {
      name: "Super Admin",
      description: "Full access to everything",
      isSystem: true,
      permissions: {
        create: [
          {
            module: "users",
            canView: true,
            canAdd: true,
            canEdit: true,
            canDelete: true,
            scope: "ALL",
          },
          {
            module: "teams",
            canView: true,
            canAdd: true,
            canEdit: true,
            canDelete: true,
            scope: "ALL",
          },
          {
            module: "clients",
            canView: true,
            canAdd: true,
            canEdit: true,
            canDelete: true,
            scope: "ALL",
          },
          {
            module: "requirements",
            canView: true,
            canAdd: true,
            canEdit: true,
            canDelete: true,
            scope: "ALL",
          },
          {
            module: "reports",
            canView: true,
            canAdd: true,
            canEdit: true,
            canDelete: true,
            scope: "ALL",
          },
        ],
      },
    },
  });

  const adminRole = await prisma.role.upsert({
    where: { name: "Admin" },
    update: {},
    create: {
      name: "Admin",
      description: "Manages users, clients, requirements within their BU",
      isSystem: true,
      permissions: {
        create: [
          {
            module: "users",
            canView: true,
            canAdd: true,
            canEdit: true,
            canDelete: false,
            scope: "BU",
          },
          {
            module: "teams",
            canView: true,
            canAdd: true,
            canEdit: true,
            canDelete: false,
            scope: "BU",
          },
          {
            module: "clients",
            canView: true,
            canAdd: true,
            canEdit: true,
            canDelete: false,
            scope: "BU",
          },
          {
            module: "requirements",
            canView: true,
            canAdd: true,
            canEdit: true,
            canDelete: false,
            scope: "BU",
          },
          {
            module: "reports",
            canView: true,
            canAdd: false,
            canEdit: false,
            canDelete: false,
            scope: "BU",
          },
        ],
      },
    },
  });

  const deliveryLeadRole = await prisma.role.upsert({
    where: { name: "Delivery Lead" },
    update: {},
    create: {
      name: "Delivery Lead",
      description: "Oversees delivery across multiple teams",
      isSystem: false,
      permissions: {
        create: [
          {
            module: "requirements",
            canView: true,
            canAdd: false,
            canEdit: true,
            canDelete: false,
            scope: "TEAM",
          },
          {
            module: "clients",
            canView: true,
            canAdd: false,
            canEdit: false,
            canDelete: false,
            scope: "TEAM",
          },
          {
            module: "reports",
            canView: true,
            canAdd: false,
            canEdit: false,
            canDelete: false,
            scope: "TEAM",
          },
        ],
      },
    },
  });

  const teamLeadRole = await prisma.role.upsert({
    where: { name: "Team Lead" },
    update: {},
    create: {
      name: "Team Lead",
      description: "Manages their team and assigns requirements",
      isSystem: false,
      permissions: {
        create: [
          {
            module: "requirements",
            canView: true,
            canAdd: false,
            canEdit: true,
            canDelete: false,
            scope: "TEAM",
          },
          {
            module: "clients",
            canView: true,
            canAdd: false,
            canEdit: false,
            canDelete: false,
            scope: "TEAM",
          },
          {
            module: "reports",
            canView: true,
            canAdd: false,
            canEdit: false,
            canDelete: false,
            scope: "TEAM",
          },
        ],
      },
    },
  });

  const recruiterRole = await prisma.role.upsert({
    where: { name: "Recruiter" },
    update: {},
    create: {
      name: "Recruiter",
      description: "Works on assigned requirements",
      isSystem: false,
      permissions: {
        create: [
          {
            module: "requirements",
            canView: true,
            canAdd: false,
            canEdit: false,
            canDelete: false,
            scope: "OWN",
          },
          {
            module: "clients",
            canView: true,
            canAdd: false,
            canEdit: false,
            canDelete: false,
            scope: "OWN",
          },
        ],
      },
    },
  });

  const salesRole = await prisma.role.upsert({
    where: { name: "Sales" },
    update: {},
    create: {
      name: "Sales",
      description: "Creates clients and raises requirements",
      isSystem: false,
      permissions: {
        create: [
          {
            module: "clients",
            canView: true,
            canAdd: true,
            canEdit: true,
            canDelete: false,
            scope: "OWN",
          },
          {
            module: "requirements",
            canView: true,
            canAdd: true,
            canEdit: false,
            canDelete: false,
            scope: "OWN",
          },
        ],
      },
    },
  });

  console.log("✅ Roles created");

  // ─────────────────────────────────────────
  // BUSINESS UNITS
  // ─────────────────────────────────────────

  const kaasBU = await prisma.businessUnit.upsert({
    where: { name: "KaaS BU" },
    update: {},
    create: { name: "KaaS BU", isActive: true },
  });

  const taasBU = await prisma.businessUnit.upsert({
    where: { name: "TaaS BU" },
    update: {},
    create: { name: "TaaS BU", isActive: true },
  });

  const oemBU = await prisma.businessUnit.upsert({
    where: { name: "OEM BU" },
    update: {},
    create: { name: "OEM BU", isActive: true },
  });

  console.log("✅ Business units created");

  // ─────────────────────────────────────────
  // USERS
  // ─────────────────────────────────────────

  const hash = (p) => bcrypt.hashSync(p, 10);

  // Super Admin
  const superAdmin = await prisma.user.upsert({
    where: { email: "superadmin@talentos.com" },
    update: {},
    create: {
      email: "superadmin@talentos.com",
      passwordHash: hash("Admin@123"),
      passwordPlain: "Admin@123",
      firstName: "Super",
      lastName: "Admin",
      employeeId: "EMP-0001",
      isSuperAdmin: true,
      isActive: true,
      roleId: superAdminRole.id,
    },
  });

  // Admin — KaaS BU
  const kaasAdmin = await prisma.user.upsert({
    where: { email: "admin.kaas@talentos.com" },
    update: {},
    create: {
      email: "admin.kaas@talentos.com",
      passwordHash: hash("Admin@123"),
      passwordPlain: "Admin@123",
      firstName: "Priya",
      lastName: "Menon",
      employeeId: "EMP-0002",
      isActive: true,
      roleId: adminRole.id,
      businessUnitId: kaasBU.id,
      createdById: superAdmin.id,
    },
  });

  // Admin — TaaS BU
  const taasAdmin = await prisma.user.upsert({
    where: { email: "admin.taas@talentos.com" },
    update: {},
    create: {
      email: "admin.taas@talentos.com",
      passwordHash: hash("Admin@123"),
      passwordPlain: "Admin@123",
      firstName: "Arjun",
      lastName: "Sharma",
      employeeId: "EMP-0003",
      isActive: true,
      roleId: adminRole.id,
      businessUnitId: taasBU.id,
      createdById: superAdmin.id,
    },
  });

  // Delivery Lead
  const deliveryLead = await prisma.user.upsert({
    where: { email: "dl.kaas@talentos.com" },
    update: {},
    create: {
      email: "dl.kaas@talentos.com",
      passwordHash: hash("Pass@123"),
      passwordPlain: "Pass@123",
      firstName: "Papitha",
      lastName: "Raj",
      employeeId: "EMP-0004",
      isActive: true,
      roleId: deliveryLeadRole.id,
      businessUnitId: kaasBU.id,
      reportingToId: kaasAdmin.id,
      createdById: kaasAdmin.id,
    },
  });

  // Team Lead
  const teamLead = await prisma.user.upsert({
    where: { email: "tl.kaas@talentos.com" },
    update: {},
    create: {
      email: "tl.kaas@talentos.com",
      passwordHash: hash("Pass@123"),
      passwordPlain: "Pass@123",
      firstName: "Joe",
      lastName: "Thomas",
      employeeId: "EMP-0005",
      isActive: true,
      roleId: teamLeadRole.id,
      businessUnitId: kaasBU.id,
      reportingToId: deliveryLead.id,
      createdById: kaasAdmin.id,
    },
  });

  // Recruiters
  const recruiter1 = await prisma.user.upsert({
    where: { email: "ritu@talentos.com" },
    update: {},
    create: {
      email: "ritu@talentos.com",
      passwordHash: hash("Pass@123"),
      passwordPlain: "Pass@123",
      firstName: "Ritu",
      lastName: "Verma",
      employeeId: "EMP-0006",
      isActive: true,
      roleId: recruiterRole.id,
      businessUnitId: kaasBU.id,
      reportingToId: teamLead.id,
      createdById: kaasAdmin.id,
    },
  });

  const recruiter2 = await prisma.user.upsert({
    where: { email: "karan@talentos.com" },
    update: {},
    create: {
      email: "karan@talentos.com",
      passwordHash: hash("Pass@123"),
      passwordPlain: "Pass@123",
      firstName: "Karan",
      lastName: "Nair",
      employeeId: "EMP-0007",
      isActive: true,
      roleId: recruiterRole.id,
      businessUnitId: kaasBU.id,
      reportingToId: teamLead.id,
      createdById: kaasAdmin.id,
    },
  });

  // Sales
  const salesUser = await prisma.user.upsert({
    where: { email: "sales1@talentos.com" },
    update: {},
    create: {
      email: "sales1@talentos.com",
      passwordHash: hash("Pass@123"),
      passwordPlain: "Pass@123",
      firstName: "Sneha",
      lastName: "Pillai",
      employeeId: "EMP-0008",
      isActive: true,
      roleId: salesRole.id,
      businessUnitId: kaasBU.id,
      reportingToId: kaasAdmin.id,
      createdById: kaasAdmin.id,
    },
  });

  console.log("✅ Users created");

  // ─────────────────────────────────────────
  // TEAMS
  // ─────────────────────────────────────────

  const joesTeam = await prisma.team.upsert({
    where: { id: "seed-team-001" },
    update: {},
    create: {
      id: "seed-team-001",
      name: "Joe's Team",
      category: "KaaS",
      isActive: true,
      businessUnitId: kaasBU.id,
      dataPolicy: "SHARED",
      members: {
        create: [
          { userId: teamLead.id, teamRole: "LEAD" },
          { userId: recruiter1.id, teamRole: "MEMBER" },
          { userId: recruiter2.id, teamRole: "MEMBER" },
        ],
      },
    },
  });

  console.log("✅ Teams created");

  // ─────────────────────────────────────────
  // CLIENT
  // ─────────────────────────────────────────

  const client1 = await prisma.client.upsert({
    where: { id: "seed-client-001" },
    update: {},
    create: {
      id: "seed-client-001",
      name: "Infosys BPM",
      vmsName: "Infosys BPM Ltd",
      category: "KaaS",
      industry: "IT Services",
      country: "India",
      state: "Karnataka",
      city: "Bangalore",
      status: "ACTIVE",
      businessUnitId: kaasBU.id,
      createdById: salesUser.id,
      approvedById: kaasAdmin.id,
      approvedAt: new Date(),
      contacts: {
        create: [
          {
            firstName: "Amit",
            lastName: "Kulkarni",
            designation: "HR Manager",
            email: "amit.k@infosysbpm.com",
            phone: "9876543210",
            isPrimary: true,
            isActive: true,
          },
        ],
      },
      handlers: {
        create: [
          {
            userId: salesUser.id,
            role: "PRIMARY",
            assignedById: kaasAdmin.id,
          },
        ],
      },
      teamAssignments: {
        create: [
          {
            teamId: joesTeam.id,
            assignedById: kaasAdmin.id,
          },
        ],
      },
    },
  });

  console.log("✅ Client created");

  // ─────────────────────────────────────────
  // REQUIREMENT
  // ─────────────────────────────────────────

  const req1 = await prisma.requirement.upsert({
    where: { reqCode: "SFJ-R-10001" },
    update: {},
    create: {
      reqCode: "SFJ-R-10001",
      title: "Senior Java Developer",
      description:
        "5+ years Java, Spring Boot, microservices experience required",
      clientId: client1.id,
      businessUnitId: kaasBU.id,
      jobType: "CONTRACT",
      remoteType: "HYBRID",
      priority: "HIGH",
      totalOpenings: 3,
      filledOpenings: 0,
      location: "Bangalore",
      country: "India",
      salaryMin: 800000,
      salaryMax: 1400000,
      salaryType: "Per Year",
      status: "ACTIVE",
      createdById: salesUser.id,
      approvedById: kaasAdmin.id,
      approvedAt: new Date(),
      deliveryLeadId: deliveryLead.id,
      teamLeadId: teamLead.id,
      assignments: {
        create: [
          {
            assignmentType: "TEAM",
            teamId: joesTeam.id,
            isAutoRouted: true,
            isSystemAssigned: true,
            allocatedOpenings: 3,
          },
          {
            assignmentType: "INDIVIDUAL",
            recruiterId: recruiter1.id,
            allocatedOpenings: 2,
            assignedById: teamLead.id,
          },
          {
            assignmentType: "INDIVIDUAL",
            recruiterId: recruiter2.id,
            allocatedOpenings: 1,
            assignedById: teamLead.id,
          },
        ],
      },
      statusHistory: {
        create: [
          {
            fromStatus: "DRAFT",
            toStatus: "PENDING_APPROVAL",
            changedById: salesUser.id,
          },
          {
            fromStatus: "PENDING_APPROVAL",
            toStatus: "ACTIVE",
            changedById: kaasAdmin.id,
            reason: "Approved by admin",
          },
        ],
      },
    },
  });

  console.log("✅ Requirement created");
  console.log("\n🎉 Seed complete\n");
  console.log("Logins:");
  console.log("  superadmin@talentos.com  /  Admin@123  (Super Admin)");
  console.log("  admin.kaas@talentos.com  /  Admin@123  (KaaS Admin)");
  console.log("  admin.taas@talentos.com  /  Admin@123  (TaaS Admin)");
  console.log("  dl.kaas@talentos.com     /  Pass@123   (Delivery Lead)");
  console.log("  tl.kaas@talentos.com     /  Pass@123   (Team Lead)");
  console.log("  ritu@talentos.com        /  Pass@123   (Recruiter)");
  console.log("  karan@talentos.com       /  Pass@123   (Recruiter)");
  console.log("  sales1@talentos.com      /  Pass@123   (Sales)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
