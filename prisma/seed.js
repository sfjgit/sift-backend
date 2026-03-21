// prisma/seed.js
// Safe to run multiple times — upserts everything, migrates old role names

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();
const hash = (p) => bcrypt.hashSync(p, 10);

// ─── Role definitions ─────────────────────────────────────────────────────────
// Single source of truth. Change here, runs everywhere.

const ROLES = [
  {
    name: "SUPER_ADMIN",
    oldName: "Super Admin", // previous name in DB — will be migrated
    description: "Full access to everything",
    isSystem: true,
    permissions: [
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
        module: "business_units",
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
      {
        module: "settings",
        canView: true,
        canAdd: true,
        canEdit: true,
        canDelete: true,
        scope: "ALL",
      },
    ],
  },
  {
    name: "ADMIN",
    oldName: "Admin",
    description: "Manages users, clients, requirements within their BU",
    isSystem: true,
    permissions: [
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
        module: "business_units",
        canView: true,
        canAdd: false,
        canEdit: false,
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
      {
        module: "settings",
        canView: true,
        canAdd: false,
        canEdit: true,
        canDelete: false,
        scope: "BU",
      },
    ],
  },
  {
    name: "DELIVERY_LEAD",
    oldName: "Delivery Lead",
    description: "Oversees delivery across teams in their BU",
    isSystem: false,
    permissions: [
      {
        module: "users",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        scope: "BU",
      },
      {
        module: "teams",
        canView: true,
        canAdd: false,
        canEdit: true,
        canDelete: false,
        scope: "BU",
      },
      {
        module: "clients",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        scope: "BU",
      },
      {
        module: "requirements",
        canView: true,
        canAdd: false,
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
  {
    name: "TEAM_LEAD",
    oldName: "Team Lead",
    description: "Manages their team and assigns requirements to members",
    isSystem: false,
    permissions: [
      {
        module: "users",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        scope: "TEAM",
      },
      {
        module: "teams",
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
        module: "requirements",
        canView: true,
        canAdd: false,
        canEdit: true,
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
  {
    name: "RECRUITER",
    oldName: "Recruiter",
    description: "Works only on requirements assigned to them",
    isSystem: false,
    permissions: [
      {
        module: "clients",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        scope: "TEAM",
      },
      {
        module: "requirements",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        scope: "OWN",
      },
      {
        module: "reports",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        scope: "OWN",
      },
    ],
  },
  {
    name: "SALES",
    oldName: "Sales",
    description: "Creates clients and raises requirements",
    isSystem: false,
    permissions: [
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
      {
        module: "reports",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        scope: "OWN",
      },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function upsertRole(roleDef) {
  const { oldName, permissions, ...roleData } = roleDef;

  // If old name exists in DB, rename it first
  const existing = await prisma.role.findUnique({ where: { name: oldName } });
  if (existing && oldName !== roleData.name) {
    console.log(`  ↳ Renaming "${oldName}" → "${roleData.name}"`);
    await prisma.role.update({
      where: { name: oldName },
      data: { name: roleData.name },
    });
  }

  // Upsert the role
  const role = await prisma.role.upsert({
    where: { name: roleData.name },
    update: {
      description: roleData.description,
      isSystem: roleData.isSystem,
    },
    create: roleData,
  });

  // Sync permissions — delete all and recreate for clean state
  await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
  await prisma.rolePermission.createMany({
    data: permissions.map((p) => ({ ...p, roleId: role.id })),
  });

  return role;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Running migration seed...\n");

  // ── Roles ──────────────────────────────────────────────────────────────────

  console.log("📋 Upserting roles...");
  const roles = {};
  for (const roleDef of ROLES) {
    const role = await upsertRole(roleDef);
    roles[role.name] = role;
    console.log(`  ✅ ${role.name}`);
  }

  // ── Business Units ─────────────────────────────────────────────────────────

  console.log("\n🏢 Upserting business units...");
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
  console.log("  ✅ KaaS BU, TaaS BU, OEM BU");

  // ── Users ──────────────────────────────────────────────────────────────────

  console.log("\n👤 Upserting users...");

  const superAdmin = await prisma.user.upsert({
    where: { email: "superadmin@talentos.com" },
    update: { roleId: roles["SUPER_ADMIN"].id },
    create: {
      email: "superadmin@talentos.com",
      passwordHash: hash("Admin@123"),
      passwordPlain: "Admin@123",
      firstName: "Super",
      lastName: "Admin",
      employeeId: "EMP-0001",
      isSuperAdmin: true,
      isActive: true,
      roleId: roles["SUPER_ADMIN"].id,
    },
  });

  const kaasAdmin = await prisma.user.upsert({
    where: { email: "admin.kaas@talentos.com" },
    update: { roleId: roles["ADMIN"].id },
    create: {
      email: "admin.kaas@talentos.com",
      passwordHash: hash("Admin@123"),
      passwordPlain: "Admin@123",
      firstName: "Priya",
      lastName: "Menon",
      employeeId: "EMP-0002",
      isActive: true,
      roleId: roles["ADMIN"].id,
      businessUnitId: kaasBU.id,
      createdById: superAdmin.id,
    },
  });

  const taasAdmin = await prisma.user.upsert({
    where: { email: "admin.taas@talentos.com" },
    update: { roleId: roles["ADMIN"].id },
    create: {
      email: "admin.taas@talentos.com",
      passwordHash: hash("Admin@123"),
      passwordPlain: "Admin@123",
      firstName: "Arjun",
      lastName: "Sharma",
      employeeId: "EMP-0003",
      isActive: true,
      roleId: roles["ADMIN"].id,
      businessUnitId: taasBU.id,
      createdById: superAdmin.id,
    },
  });

  const deliveryLead = await prisma.user.upsert({
    where: { email: "dl.kaas@talentos.com" },
    update: { roleId: roles["DELIVERY_LEAD"].id },
    create: {
      email: "dl.kaas@talentos.com",
      passwordHash: hash("Pass@123"),
      passwordPlain: "Pass@123",
      firstName: "Papitha",
      lastName: "Raj",
      employeeId: "EMP-0004",
      isActive: true,
      roleId: roles["DELIVERY_LEAD"].id,
      businessUnitId: kaasBU.id,
      reportingToId: kaasAdmin.id,
      createdById: kaasAdmin.id,
    },
  });

  const teamLead = await prisma.user.upsert({
    where: { email: "tl.kaas@talentos.com" },
    update: { roleId: roles["TEAM_LEAD"].id },
    create: {
      email: "tl.kaas@talentos.com",
      passwordHash: hash("Pass@123"),
      passwordPlain: "Pass@123",
      firstName: "Joe",
      lastName: "Thomas",
      employeeId: "EMP-0005",
      isActive: true,
      roleId: roles["TEAM_LEAD"].id,
      businessUnitId: kaasBU.id,
      reportingToId: deliveryLead.id,
      createdById: kaasAdmin.id,
    },
  });

  const recruiter1 = await prisma.user.upsert({
    where: { email: "ritu@talentos.com" },
    update: { roleId: roles["RECRUITER"].id },
    create: {
      email: "ritu@talentos.com",
      passwordHash: hash("Pass@123"),
      passwordPlain: "Pass@123",
      firstName: "Ritu",
      lastName: "Verma",
      employeeId: "EMP-0006",
      isActive: true,
      roleId: roles["RECRUITER"].id,
      businessUnitId: kaasBU.id,
      reportingToId: teamLead.id,
      createdById: kaasAdmin.id,
    },
  });

  const recruiter2 = await prisma.user.upsert({
    where: { email: "karan@talentos.com" },
    update: { roleId: roles["RECRUITER"].id },
    create: {
      email: "karan@talentos.com",
      passwordHash: hash("Pass@123"),
      passwordPlain: "Pass@123",
      firstName: "Karan",
      lastName: "Nair",
      employeeId: "EMP-0007",
      isActive: true,
      roleId: roles["RECRUITER"].id,
      businessUnitId: kaasBU.id,
      reportingToId: teamLead.id,
      createdById: kaasAdmin.id,
    },
  });

  const salesUser = await prisma.user.upsert({
    where: { email: "sales1@talentos.com" },
    update: { roleId: roles["SALES"].id },
    create: {
      email: "sales1@talentos.com",
      passwordHash: hash("Pass@123"),
      passwordPlain: "Pass@123",
      firstName: "Sneha",
      lastName: "Pillai",
      employeeId: "EMP-0008",
      isActive: true,
      roleId: roles["SALES"].id,
      businessUnitId: kaasBU.id,
      reportingToId: kaasAdmin.id,
      createdById: kaasAdmin.id,
    },
  });

  console.log("  ✅ 8 users upserted");

  // ── Team ───────────────────────────────────────────────────────────────────

  console.log("\n👥 Upserting teams...");
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
    },
  });

  // Upsert team members individually (@@unique[userId, teamId] guard)
  for (const [userId, teamRole] of [
    [teamLead.id, "LEAD"],
    [recruiter1.id, "MEMBER"],
    [recruiter2.id, "MEMBER"],
  ]) {
    await prisma.teamMember.upsert({
      where: { userId_teamId: { userId, teamId: joesTeam.id } },
      update: { teamRole },
      create: { userId, teamId: joesTeam.id, teamRole },
    });
  }
  console.log("  ✅ Joe's Team + 3 members");

  // ── Client ─────────────────────────────────────────────────────────────────

  console.log("\n🏭 Upserting client...");
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
    },
  });

  // Contact
  const existingContact = await prisma.clientContact.findFirst({
    where: { clientId: client1.id, email: "amit.k@infosysbpm.com" },
  });
  if (!existingContact) {
    await prisma.clientContact.create({
      data: {
        clientId: client1.id,
        firstName: "Amit",
        lastName: "Kulkarni",
        designation: "HR Manager",
        email: "amit.k@infosysbpm.com",
        phone: "9876543210",
        isPrimary: true,
        isActive: true,
      },
    });
  }

  // Handler
  await prisma.clientHandler.upsert({
    where: { clientId_userId: { clientId: client1.id, userId: salesUser.id } },
    update: {},
    create: {
      clientId: client1.id,
      userId: salesUser.id,
      role: "PRIMARY",
      assignedById: kaasAdmin.id,
    },
  });

  // Team assignment
  await prisma.clientTeamAssignment.upsert({
    where: { clientId_teamId: { clientId: client1.id, teamId: joesTeam.id } },
    update: {},
    create: {
      clientId: client1.id,
      teamId: joesTeam.id,
      assignedById: kaasAdmin.id,
    },
  });
  console.log("  ✅ Infosys BPM + contact + handler + team assignment");

  // ── Requirement ────────────────────────────────────────────────────────────

  console.log("\n📝 Upserting requirement...");
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
    },
  });

  // Assignments — check before create (no unique key on assignments)
  const existingAssignments = await prisma.requirementAssignment.findMany({
    where: { requirementId: req1.id, status: "ACTIVE" },
  });

  if (existingAssignments.length === 0) {
    await prisma.requirementAssignment.createMany({
      data: [
        {
          requirementId: req1.id,
          assignmentType: "TEAM",
          teamId: joesTeam.id,
          isAutoRouted: true,
          isSystemAssigned: true,
          allocatedOpenings: 3,
          status: "ACTIVE",
        },
        {
          requirementId: req1.id,
          assignmentType: "INDIVIDUAL",
          recruiterId: recruiter1.id,
          allocatedOpenings: 2,
          assignedById: teamLead.id,
          status: "ACTIVE",
        },
        {
          requirementId: req1.id,
          assignmentType: "INDIVIDUAL",
          recruiterId: recruiter2.id,
          allocatedOpenings: 1,
          assignedById: teamLead.id,
          status: "ACTIVE",
        },
      ],
    });
  }

  // Status history — check before create
  const existingHistory = await prisma.requirementStatusHistory.findMany({
    where: { requirementId: req1.id },
  });

  if (existingHistory.length === 0) {
    await prisma.requirementStatusHistory.createMany({
      data: [
        {
          requirementId: req1.id,
          fromStatus: "DRAFT",
          toStatus: "PENDING_APPROVAL",
          changedById: salesUser.id,
        },
        {
          requirementId: req1.id,
          fromStatus: "PENDING_APPROVAL",
          toStatus: "ACTIVE",
          changedById: kaasAdmin.id,
          reason: "Approved by admin",
        },
      ],
    });
  }

  console.log("  ✅ SFJ-R-10001 + assignments + status history");

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log("\n🎉 Migration seed complete\n");
  console.log("┌─────────────────────────────────────────────────────┐");
  console.log("│  Logins                                             │");
  console.log("├─────────────────────────────────────────────────────┤");
  console.log("│  superadmin@talentos.com  Admin@123  SUPER_ADMIN    │");
  console.log("│  admin.kaas@talentos.com  Admin@123  ADMIN (KaaS)   │");
  console.log("│  admin.taas@talentos.com  Admin@123  ADMIN (TaaS)   │");
  console.log("│  dl.kaas@talentos.com     Pass@123   DELIVERY_LEAD  │");
  console.log("│  tl.kaas@talentos.com     Pass@123   TEAM_LEAD      │");
  console.log("│  ritu@talentos.com        Pass@123   RECRUITER      │");
  console.log("│  karan@talentos.com       Pass@123   RECRUITER      │");
  console.log("│  sales1@talentos.com      Pass@123   SALES          │");
  console.log("└─────────────────────────────────────────────────────┘");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
