// prisma/seed.js
// Safe to run multiple times — upserts everything.
// Reflects new schema: no dataPolicy, no TeamConfig, no SalesDeliveryTeamLink.
// Ecosystem lives in parentTeamId: MANAGEMENT → SALES + DELIVERY teams.

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();
const hash = (p) => bcrypt.hashSync(p, 10);

// ─────────────────────────────────────────
// ROLES
// ─────────────────────────────────────────

const ROLES = [
  {
    name: "SUPER_ADMIN",
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
    name: "DELIVERY_MANAGER",
    description: "Receives requirements from sales, assigns to teams",
    isSystem: false,
    permissions: [
      {
        module: "users",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        scope: "MANAGER",
      },
      {
        module: "teams",
        canView: true,
        canAdd: false,
        canEdit: true,
        canDelete: false,
        scope: "MANAGER",
      },
      {
        module: "clients",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        scope: "MANAGER",
      },
      {
        module: "requirements",
        canView: true,
        canAdd: false,
        canEdit: true,
        canDelete: false,
        scope: "MANAGER",
      },
      {
        module: "reports",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        scope: "MANAGER",
      },
    ],
  },
  {
    name: "TEAM_LEAD",
    description: "Manages their team and assigns requirements to recruiters",
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

async function upsertRole(roleDef) {
  const { permissions, ...roleData } = roleDef;

  const role = await prisma.role.upsert({
    where: { name: roleData.name },
    update: { description: roleData.description, isSystem: roleData.isSystem },
    create: roleData,
  });

  // wipe and recreate for clean state
  await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
  await prisma.rolePermission.createMany({
    data: permissions.map((p) => ({ ...p, roleId: role.id })),
  });

  return role;
}

// ─────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────

async function main() {
  console.log("🌱 Seeding...\n");

  // ── Roles ──────────────────────────────────────────────────────────────────
  console.log("📋 Roles...");
  const roles = {};
  for (const r of ROLES) {
    const role = await upsertRole(r);
    roles[role.name] = role;
    console.log(`  ✅ ${role.name}`);
  }

  // ── Business Units ─────────────────────────────────────────────────────────
  console.log("\n🏢 Business Units...");
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
  console.log("  ✅ KaaS BU, TaaS BU");

  // ── Users ──────────────────────────────────────────────────────────────────
  console.log("\n👤 Users...");

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

  // Delivery Manager — MANAGER level in the assignment chain
  const deliveryManager = await prisma.user.upsert({
    where: { email: "dm.kaas@talentos.com" },
    update: { roleId: roles["DELIVERY_MANAGER"].id },
    create: {
      email: "dm.kaas@talentos.com",
      passwordHash: hash("Pass@123"),
      passwordPlain: "Pass@123",
      firstName: "Papitha",
      lastName: "Raj",
      employeeId: "EMP-0003",
      isActive: true,
      roleId: roles["DELIVERY_MANAGER"].id,
      businessUnitId: kaasBU.id,
      reportingToId: kaasAdmin.id,
      createdById: kaasAdmin.id,
    },
  });

  // Team Lead — CO_LEAD of delivery team, assigns to recruiters
  const teamLead = await prisma.user.upsert({
    where: { email: "tl.kaas@talentos.com" },
    update: { roleId: roles["TEAM_LEAD"].id },
    create: {
      email: "tl.kaas@talentos.com",
      passwordHash: hash("Pass@123"),
      passwordPlain: "Pass@123",
      firstName: "Joe",
      lastName: "Thomas",
      employeeId: "EMP-0004",
      isActive: true,
      roleId: roles["TEAM_LEAD"].id,
      businessUnitId: kaasBU.id,
      reportingToId: deliveryManager.id,
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
      employeeId: "EMP-0005",
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
      employeeId: "EMP-0006",
      isActive: true,
      roleId: roles["RECRUITER"].id,
      businessUnitId: kaasBU.id,
      reportingToId: teamLead.id,
      createdById: kaasAdmin.id,
    },
  });

  // Sales person — member of Sales team, raises requirements
  const salesUser = await prisma.user.upsert({
    where: { email: "sales1@talentos.com" },
    update: { roleId: roles["SALES"].id },
    create: {
      email: "sales1@talentos.com",
      passwordHash: hash("Pass@123"),
      passwordPlain: "Pass@123",
      firstName: "Sneha",
      lastName: "Pillai",
      employeeId: "EMP-0007",
      isActive: true,
      roleId: roles["SALES"].id,
      businessUnitId: kaasBU.id,
      reportingToId: kaasAdmin.id,
      createdById: kaasAdmin.id,
    },
  });

  console.log("  ✅ 7 users");

  // ── Teams — Ecosystem via parentTeamId ─────────────────────────────────────
  //
  // Structure:
  //   KaaS Ecosystem (MANAGEMENT) ← root, parentTeamId: null
  //     ├── KaaS Sales Team (SALES)    ← parentTeamId: ecosystem.id
  //     └── KaaS Delivery Team (DELIVERY) ← parentTeamId: ecosystem.id
  //           └── Joe's Sub-Team (DELIVERY) ← parentTeamId: deliveryTeam.id
  //
  // Controllers walk this tree to derive cross-team relationships.
  // No junction table needed.
  // ───────────────────────────────────────────────────────────────────────────

  console.log("\n👥 Teams (ecosystem structure)...");

  // Root — the ecosystem
  const ecosystem = await prisma.team.upsert({
    where: { id: "seed-team-ecosystem-kaas" },
    update: { name: "KaaS Ecosystem" },
    create: {
      id: "seed-team-ecosystem-kaas",
      name: "KaaS Ecosystem",
      description: "Root ecosystem for KaaS BU — groups sales and delivery",
      category: "MANAGEMENT",
      isActive: true,
      businessUnitId: kaasBU.id,
    },
  });

  // Sales team — sits under ecosystem
  const salesTeam = await prisma.team.upsert({
    where: { id: "seed-team-sales-kaas" },
    update: { name: "KaaS Sales Team" },
    create: {
      id: "seed-team-sales-kaas",
      name: "KaaS Sales Team",
      category: "SALES",
      isActive: true,
      businessUnitId: kaasBU.id,
      parentTeamId: ecosystem.id, // ← ecosystem link
    },
  });

  // Delivery team — sits under ecosystem, delivery manager is LEAD
  const deliveryTeam = await prisma.team.upsert({
    where: { id: "seed-team-delivery-kaas" },
    update: { name: "KaaS Delivery Team" },
    create: {
      id: "seed-team-delivery-kaas",
      name: "KaaS Delivery Team",
      category: "DELIVERY",
      isActive: true,
      businessUnitId: kaasBU.id,
      parentTeamId: ecosystem.id, // ← ecosystem link
    },
  });

  // Joe's sub-team — sits under delivery team
  const joesTeam = await prisma.team.upsert({
    where: { id: "seed-team-joes-kaas" },
    update: { name: "Joe's Team" },
    create: {
      id: "seed-team-joes-kaas",
      name: "Joe's Team",
      category: "DELIVERY",
      isActive: true,
      businessUnitId: kaasBU.id,
      parentTeamId: deliveryTeam.id, // ← sits under delivery team
    },
  });

  // Team memberships
  const memberships = [
    // Sales team
    { userId: salesUser.id, teamId: salesTeam.id, teamRole: "MEMBER" },
    // Delivery team — delivery manager is LEAD
    { userId: deliveryManager.id, teamId: deliveryTeam.id, teamRole: "LEAD" },
    // Joe's sub-team — TL is LEAD, recruiters are MEMBER
    { userId: teamLead.id, teamId: joesTeam.id, teamRole: "LEAD" },
    { userId: recruiter1.id, teamId: joesTeam.id, teamRole: "MEMBER" },
    { userId: recruiter2.id, teamId: joesTeam.id, teamRole: "MEMBER" },
  ];

  for (const m of memberships) {
    await prisma.teamMember.upsert({
      where: { userId_teamId: { userId: m.userId, teamId: m.teamId } },
      update: { teamRole: m.teamRole },
      create: m,
    });
  }

  console.log("  ✅ Ecosystem → Sales Team + Delivery Team → Joe's Team");

  // ── Client ─────────────────────────────────────────────────────────────────
  console.log("\n🏭 Client...");

  const client1 = await prisma.clientClient.upsert({
    where: { id: "seed-client-001" },
    update: {},
    create: {
      id: "seed-client-001",
      name: "Infosys BPM",
      vmsName: "Infosys BPM Ltd",
      category: "SERVICE",
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

  // Contact — findFirst guard since no unique on email per client
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

  // Handler — sales user is PRIMARY handler
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

  // Team assignment — delivery team handles this client
  await prisma.clientTeamAssignment.upsert({
    where: {
      clientId_teamId: { clientId: client1.id, teamId: deliveryTeam.id },
    },
    update: {},
    create: {
      clientId: client1.id,
      teamId: deliveryTeam.id,
      assignedById: kaasAdmin.id,
    },
  });

  console.log("  ✅ Infosys BPM + contact + handler + team assignment");

  // ── Requirement ────────────────────────────────────────────────────────────
  console.log("\n📝 Requirement...");

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
      salaryType: "ANNUAL",
      status: "ACTIVE",
      createdById: salesUser.id,
      approvedById: kaasAdmin.id,
      approvedAt: new Date(),
    },
  });

  // ── Assignment chain ───────────────────────────────────────────────────────
  //
  //  MANAGER row  → deliveryManager  (allocated: 3)
  //    TEAM row   → joesTeam         (allocated: 3, parent: MANAGER row)
  //      INDIVIDUAL → recruiter1     (allocated: 2, parent: TEAM row)
  //      INDIVIDUAL → recruiter2     (allocated: 1, parent: TEAM row)
  // ───────────────────────────────────────────────────────────────────────────

  const existingAssignments = await prisma.requirementAssignment.findMany({
    where: { requirementId: req1.id, status: "ACTIVE" },
  });

  if (existingAssignments.length === 0) {
    // MANAGER row
    const managerAssignment = await prisma.requirementAssignment.create({
      data: {
        requirementId: req1.id,
        assignmentType: "MANAGER",
        recruiterId: deliveryManager.id,
        allocatedOpenings: 3,
        assignedById: kaasAdmin.id,
        status: "ACTIVE",
      },
    });

    // TEAM row — parent is MANAGER row
    const teamAssignment = await prisma.requirementAssignment.create({
      data: {
        requirementId: req1.id,
        assignmentType: "TEAM",
        teamId: joesTeam.id,
        allocatedOpenings: 3,
        assignedById: deliveryManager.id,
        parentAssignmentId: managerAssignment.id,
        status: "ACTIVE",
      },
    });

    // INDIVIDUAL rows — parent is TEAM row
    await prisma.requirementAssignment.createMany({
      data: [
        {
          requirementId: req1.id,
          assignmentType: "INDIVIDUAL",
          recruiterId: recruiter1.id,
          allocatedOpenings: 2,
          assignedById: teamLead.id,
          parentAssignmentId: teamAssignment.id,
          status: "ACTIVE",
        },
        {
          requirementId: req1.id,
          assignmentType: "INDIVIDUAL",
          recruiterId: recruiter2.id,
          allocatedOpenings: 1,
          assignedById: teamLead.id,
          parentAssignmentId: teamAssignment.id,
          status: "ACTIVE",
        },
      ],
    });
  }

  // Status history
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

  // Activity feed entries
  const existingActivities = await prisma.requirementActivity.findMany({
    where: { requirementId: req1.id },
  });

  if (existingActivities.length === 0) {
    await prisma.requirementActivity.createMany({
      data: [
        {
          requirementId: req1.id,
          actorId: salesUser.id,
          type: "REQUIREMENT_CREATED",
          summary: "Sneha Pillai created this requirement",
        },
        {
          requirementId: req1.id,
          actorId: kaasAdmin.id,
          type: "REQUIREMENT_APPROVED",
          summary: "Priya Menon approved this requirement",
        },
        {
          requirementId: req1.id,
          actorId: kaasAdmin.id,
          type: "MANAGER_ASSIGNED",
          summary: "Papitha Raj assigned as delivery manager",
          meta: { assigneeId: deliveryManager.id, assigneeName: "Papitha Raj" },
        },
        {
          requirementId: req1.id,
          actorId: deliveryManager.id,
          type: "TEAM_ASSIGNED",
          summary: "Joe's Team assigned to this requirement",
          meta: { teamId: joesTeam.id, teamName: "Joe's Team" },
        },
        {
          requirementId: req1.id,
          actorId: teamLead.id,
          type: "RECRUITER_ASSIGNED",
          summary: "Ritu Verma and Karan Nair assigned as recruiters",
        },
      ],
    });
  }

  console.log("  ✅ SFJ-R-10001 + full assignment chain + history + activity");

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n🎉 Seed complete\n");
  console.log(
    "┌──────────────────────────────────────────────────────────────┐"
  );
  console.log(
    "│  Logins                                                      │"
  );
  console.log(
    "├──────────────────────────────────────────────────────────────┤"
  );
  console.log(
    "│  superadmin@talentos.com   Admin@123   SUPER_ADMIN           │"
  );
  console.log(
    "│  admin.kaas@talentos.com   Admin@123   ADMIN (KaaS)          │"
  );
  console.log(
    "│  dm.kaas@talentos.com      Pass@123    DELIVERY_MANAGER      │"
  );
  console.log(
    "│  tl.kaas@talentos.com      Pass@123    TEAM_LEAD             │"
  );
  console.log(
    "│  ritu@talentos.com         Pass@123    RECRUITER             │"
  );
  console.log(
    "│  karan@talentos.com        Pass@123    RECRUITER             │"
  );
  console.log(
    "│  sales1@talentos.com       Pass@123    SALES                 │"
  );
  console.log(
    "└──────────────────────────────────────────────────────────────┘"
  );
  console.log("\n  Ecosystem: KaaS Ecosystem");
  console.log("    ├── KaaS Sales Team    (Sneha)");
  console.log("    └── KaaS Delivery Team (Papitha — LEAD)");
  console.log("          └── Joe's Team   (Joe — LEAD, Ritu + Karan — MEMBER)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
