// prisma/seed.js
// Safe to run multiple times — upserts everything.
// 7 original users preserved + 55 new employees across KaaS & TaaS BUs.
// Rich data: 2 BU ecosystems, full team trees, 8 clients, 25 requirements,
// full assignment chains, status histories, activities, notes.

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();
const hash = (p) => bcrypt.hashSync(p, 10);

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

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
  await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
  await prisma.rolePermission.createMany({
    data: permissions.map((p) => ({ ...p, roleId: role.id })),
  });
  return role;
}

// ─────────────────────────────────────────
// NAMES POOL — Indian names for realistic data
// ─────────────────────────────────────────

const FIRST_NAMES = [
  "Arjun",
  "Priya",
  "Rahul",
  "Sneha",
  "Vikram",
  "Ananya",
  "Karthik",
  "Divya",
  "Siddharth",
  "Pooja",
  "Aakash",
  "Meera",
  "Rohan",
  "Nandini",
  "Ajay",
  "Kavya",
  "Suresh",
  "Lakshmi",
  "Nikhil",
  "Swathi",
  "Deepak",
  "Asha",
  "Manoj",
  "Revathi",
  "Harish",
  "Sunita",
  "Vinod",
  "Geetha",
  "Sanjay",
  "Radha",
  "Prakash",
  "Uma",
  "Ravi",
  "Saranya",
  "Mohan",
  "Pavithra",
  "Ganesh",
  "Janani",
  "Ramesh",
  "Krithika",
  "Sunil",
  "Mythili",
  "Varun",
  "Bhavana",
  "Naveen",
  "Chithra",
  "Balaji",
  "Hema",
  "Ashwin",
  "Yamini",
  "Dinesh",
  "Usha",
  "Gopal",
  "Sumathi",
  "Murugan",
  "Vijaya",
  "Rajesh",
  "Nalini",
  "Venkat",
  "Padma",
];

const LAST_NAMES = [
  "Kumar",
  "Sharma",
  "Pillai",
  "Nair",
  "Iyer",
  "Menon",
  "Rao",
  "Reddy",
  "Patel",
  "Joshi",
  "Krishnan",
  "Subramaniam",
  "Venkataraman",
  "Chandrasekaran",
  "Balakrishnan",
  "Narayanan",
  "Raghunathan",
  "Sundaram",
  "Parthasarathy",
  "Annamalai",
  "Murugesan",
  "Subramanian",
  "Ramasamy",
  "Arumugam",
  "Dakshinamurthy",
  "Natarajan",
  "Rajan",
  "Balasubramanian",
  "Ganesan",
  "Lakshminayana",
  "Thomas",
  "George",
  "Philip",
  "Mathew",
  "Varghese",
  "Abraham",
  "Joseph",
  "Xavier",
  "Fernandez",
  "D'Souza",
  "Pereira",
  "Rodrigues",
  "Sequeira",
  "Shetty",
  "Kamath",
];

function makeName(index) {
  return {
    firstName: FIRST_NAMES[index % FIRST_NAMES.length],
    lastName:
      LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length],
  };
}

function makeEmail(firstName, lastName, bu, index) {
  return `${firstName.toLowerCase()}.${lastName.toLowerCase()}${index}@talentos.com`;
}

// ─────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────

async function main() {
  console.log("🌱 Seeding TalentOS — rich dataset...\n");

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

  // ── Original 7 Users (preserved) ──────────────────────────────────────────
  console.log("\n👤 Original users...");

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
      firstName: "Rajesh",
      lastName: "Iyer",
      employeeId: "EMP-0008",
      isActive: true,
      roleId: roles["ADMIN"].id,
      businessUnitId: taasBU.id,
      createdById: superAdmin.id,
    },
  });

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

  console.log("  ✅ 8 original users");

  // ── Team Structure ─────────────────────────────────────────────────────────
  // KaaS Ecosystem
  //   ├── KaaS Sales Team
  //   └── KaaS Delivery Team
  //         ├── Joe's Team (original)
  //         ├── Alpha Squad
  //         └── Beta Squad
  //
  // TaaS Ecosystem
  //   ├── TaaS Sales Team
  //   └── TaaS Delivery Team
  //         ├── Delta Team
  //         └── Gamma Team
  // ──────────────────────────────────────────────────────────────────────────

  console.log("\n👥 Teams (full ecosystem trees)...");

  // ── KaaS Teams ──
  const kaasEcosystem = await prisma.team.upsert({
    where: { id: "seed-team-ecosystem-kaas" },
    update: { name: "KaaS Ecosystem" },
    create: {
      id: "seed-team-ecosystem-kaas",
      name: "KaaS Ecosystem",
      description: "Root ecosystem for KaaS BU",
      category: "MANAGEMENT",
      isActive: true,
      businessUnitId: kaasBU.id,
    },
  });

  const kaasSalesTeam = await prisma.team.upsert({
    where: { id: "seed-team-sales-kaas" },
    update: { name: "KaaS Sales Team" },
    create: {
      id: "seed-team-sales-kaas",
      name: "KaaS Sales Team",
      category: "SALES",
      isActive: true,
      businessUnitId: kaasBU.id,
      parentTeamId: kaasEcosystem.id,
    },
  });

  const kaasDeliveryTeam = await prisma.team.upsert({
    where: { id: "seed-team-delivery-kaas" },
    update: { name: "KaaS Delivery Team" },
    create: {
      id: "seed-team-delivery-kaas",
      name: "KaaS Delivery Team",
      category: "DELIVERY",
      isActive: true,
      businessUnitId: kaasBU.id,
      parentTeamId: kaasEcosystem.id,
    },
  });

  const joesTeam = await prisma.team.upsert({
    where: { id: "seed-team-joes-kaas" },
    update: { name: "Joe's Team" },
    create: {
      id: "seed-team-joes-kaas",
      name: "Joe's Team",
      category: "DELIVERY",
      isActive: true,
      businessUnitId: kaasBU.id,
      parentTeamId: kaasDeliveryTeam.id,
    },
  });

  const alphaSquad = await prisma.team.upsert({
    where: { id: "seed-team-alpha-kaas" },
    update: { name: "Alpha Squad" },
    create: {
      id: "seed-team-alpha-kaas",
      name: "Alpha Squad",
      description: "Senior tech stack recruiters",
      category: "DELIVERY",
      isActive: true,
      businessUnitId: kaasBU.id,
      parentTeamId: kaasDeliveryTeam.id,
    },
  });

  const betaSquad = await prisma.team.upsert({
    where: { id: "seed-team-beta-kaas" },
    update: { name: "Beta Squad" },
    create: {
      id: "seed-team-beta-kaas",
      name: "Beta Squad",
      description: "Mid-level and contract roles",
      category: "DELIVERY",
      isActive: true,
      businessUnitId: kaasBU.id,
      parentTeamId: kaasDeliveryTeam.id,
    },
  });

  // ── TaaS Teams ──
  const taasEcosystem = await prisma.team.upsert({
    where: { id: "seed-team-ecosystem-taas" },
    update: { name: "TaaS Ecosystem" },
    create: {
      id: "seed-team-ecosystem-taas",
      name: "TaaS Ecosystem",
      description: "Root ecosystem for TaaS BU",
      category: "MANAGEMENT",
      isActive: true,
      businessUnitId: taasBU.id,
    },
  });

  const taasSalesTeam = await prisma.team.upsert({
    where: { id: "seed-team-sales-taas" },
    update: { name: "TaaS Sales Team" },
    create: {
      id: "seed-team-sales-taas",
      name: "TaaS Sales Team",
      category: "SALES",
      isActive: true,
      businessUnitId: taasBU.id,
      parentTeamId: taasEcosystem.id,
    },
  });

  const taasDeliveryTeam = await prisma.team.upsert({
    where: { id: "seed-team-delivery-taas" },
    update: { name: "TaaS Delivery Team" },
    create: {
      id: "seed-team-delivery-taas",
      name: "TaaS Delivery Team",
      category: "DELIVERY",
      isActive: true,
      businessUnitId: taasBU.id,
      parentTeamId: taasEcosystem.id,
    },
  });

  const deltaTeam = await prisma.team.upsert({
    where: { id: "seed-team-delta-taas" },
    update: { name: "Delta Team" },
    create: {
      id: "seed-team-delta-taas",
      name: "Delta Team",
      description: "BFSI & consulting vertical",
      category: "DELIVERY",
      isActive: true,
      businessUnitId: taasBU.id,
      parentTeamId: taasDeliveryTeam.id,
    },
  });

  const gammaTeam = await prisma.team.upsert({
    where: { id: "seed-team-gamma-taas" },
    update: { name: "Gamma Team" },
    create: {
      id: "seed-team-gamma-taas",
      name: "Gamma Team",
      description: "SAP & ERP specialists",
      category: "DELIVERY",
      isActive: true,
      businessUnitId: taasBU.id,
      parentTeamId: taasDeliveryTeam.id,
    },
  });

  console.log("  ✅ KaaS: Ecosystem → Sales + Delivery → Joe's / Alpha / Beta");
  console.log("  ✅ TaaS: Ecosystem → Sales + Delivery → Delta / Gamma");

  // ── Bulk Users — 55 new employees ──────────────────────────────────────────
  console.log("\n👤 Bulk users (55 new)...");

  // Roles split plan:
  // KaaS: 2 DMs, 3 TLs, 14 Recruiters, 4 Sales  = 23
  // TaaS: 2 DMs, 3 TLs, 14 Recruiters, 4 Sales  = 23
  // Shared/extra: 4 Recruiters, 5 Sales           =  9
  // Total: 55

  const newUsers = {};
  let empIndex = 9; // EMP-0009 onwards

  async function createUser(
    key,
    firstName,
    lastName,
    role,
    buId,
    reportingToId,
    createdById
  ) {
    const empId = `EMP-${String(empIndex).padStart(4, "0")}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${empIndex}@talentos.com`;
    empIndex++;

    const user = await prisma.user.upsert({
      where: { email },
      update: { roleId: roles[role].id },
      create: {
        email,
        passwordHash: hash("Pass@123"),
        passwordPlain: "Pass@123",
        firstName,
        lastName,
        employeeId: empId,
        isActive: true,
        roleId: roles[role].id,
        businessUnitId: buId,
        reportingToId,
        createdById,
      },
    });
    newUsers[key] = user;
    return user;
  }

  // ── KaaS DMs ──
  await createUser(
    "kaasDM2",
    "Nandini",
    "Krishnan",
    "DELIVERY_MANAGER",
    kaasBU.id,
    kaasAdmin.id,
    kaasAdmin.id
  );
  await createUser(
    "kaasDM3",
    "Suresh",
    "Balakrishnan",
    "DELIVERY_MANAGER",
    kaasBU.id,
    kaasAdmin.id,
    kaasAdmin.id
  );

  // ── KaaS TLs ──
  await createUser(
    "kaasTL2",
    "Ananya",
    "Reddy",
    "TEAM_LEAD",
    kaasBU.id,
    newUsers.kaasDM2.id,
    kaasAdmin.id
  );
  await createUser(
    "kaasTL3",
    "Vikram",
    "Patel",
    "TEAM_LEAD",
    kaasBU.id,
    newUsers.kaasDM2.id,
    kaasAdmin.id
  );
  await createUser(
    "kaasTL4",
    "Divya",
    "Sharma",
    "TEAM_LEAD",
    kaasBU.id,
    newUsers.kaasDM3.id,
    kaasAdmin.id
  );

  // ── KaaS Sales ──
  await createUser(
    "kaasSales2",
    "Rohan",
    "Joshi",
    "SALES",
    kaasBU.id,
    kaasAdmin.id,
    kaasAdmin.id
  );
  await createUser(
    "kaasSales3",
    "Kavya",
    "Rao",
    "SALES",
    kaasBU.id,
    kaasAdmin.id,
    kaasAdmin.id
  );
  await createUser(
    "kaasSales4",
    "Aakash",
    "Shetty",
    "SALES",
    kaasBU.id,
    kaasAdmin.id,
    kaasAdmin.id
  );
  await createUser(
    "kaasSales5",
    "Meera",
    "Kamath",
    "SALES",
    kaasBU.id,
    kaasAdmin.id,
    kaasAdmin.id
  );

  // ── KaaS Recruiters — Alpha Squad (under TL2) ──
  await createUser(
    "kaasR3",
    "Arjun",
    "Kumar",
    "RECRUITER",
    kaasBU.id,
    newUsers.kaasTL2.id,
    kaasAdmin.id
  );
  await createUser(
    "kaasR4",
    "Pooja",
    "Iyer",
    "RECRUITER",
    kaasBU.id,
    newUsers.kaasTL2.id,
    kaasAdmin.id
  );
  await createUser(
    "kaasR5",
    "Rahul",
    "Menon",
    "RECRUITER",
    kaasBU.id,
    newUsers.kaasTL2.id,
    kaasAdmin.id
  );
  await createUser(
    "kaasR6",
    "Swathi",
    "Nair",
    "RECRUITER",
    kaasBU.id,
    newUsers.kaasTL2.id,
    kaasAdmin.id
  );
  await createUser(
    "kaasR7",
    "Ajay",
    "Pillai",
    "RECRUITER",
    kaasBU.id,
    newUsers.kaasTL2.id,
    kaasAdmin.id
  );

  // ── KaaS Recruiters — Beta Squad (under TL3) ──
  await createUser(
    "kaasR8",
    "Harish",
    "Venkat",
    "RECRUITER",
    kaasBU.id,
    newUsers.kaasTL3.id,
    kaasAdmin.id
  );
  await createUser(
    "kaasR9",
    "Lakshmi",
    "Ganesan",
    "RECRUITER",
    kaasBU.id,
    newUsers.kaasTL3.id,
    kaasAdmin.id
  );
  await createUser(
    "kaasR10",
    "Sanjay",
    "Ramasamy",
    "RECRUITER",
    kaasBU.id,
    newUsers.kaasTL3.id,
    kaasAdmin.id
  );
  await createUser(
    "kaasR11",
    "Asha",
    "Natarajan",
    "RECRUITER",
    kaasBU.id,
    newUsers.kaasTL3.id,
    kaasAdmin.id
  );
  await createUser(
    "kaasR12",
    "Vinod",
    "Rajan",
    "RECRUITER",
    kaasBU.id,
    newUsers.kaasTL3.id,
    kaasAdmin.id
  );

  // ── KaaS Recruiters — TL4 squad ──
  await createUser(
    "kaasR13",
    "Geetha",
    "Sundaram",
    "RECRUITER",
    kaasBU.id,
    newUsers.kaasTL4.id,
    kaasAdmin.id
  );
  await createUser(
    "kaasR14",
    "Nikhil",
    "Raghunathan",
    "RECRUITER",
    kaasBU.id,
    newUsers.kaasTL4.id,
    kaasAdmin.id
  );
  await createUser(
    "kaasR15",
    "Deepak",
    "Annamalai",
    "RECRUITER",
    kaasBU.id,
    newUsers.kaasTL4.id,
    kaasAdmin.id
  );
  await createUser(
    "kaasR16",
    "Bhavana",
    "Chandrasekaran",
    "RECRUITER",
    kaasBU.id,
    newUsers.kaasTL4.id,
    kaasAdmin.id
  );

  console.log("  ✅ KaaS: 2 DMs, 3 TLs, 14 Recruiters, 4 Sales");

  // ── TaaS DMs ──
  await createUser(
    "taasDM1",
    "Karthik",
    "Subramaniam",
    "DELIVERY_MANAGER",
    taasBU.id,
    taasAdmin.id,
    taasAdmin.id
  );
  await createUser(
    "taasDM2",
    "Revathi",
    "Parthasarathy",
    "DELIVERY_MANAGER",
    taasBU.id,
    taasAdmin.id,
    taasAdmin.id
  );

  // ── TaaS TLs ──
  await createUser(
    "taasTL1",
    "Varun",
    "Dakshinamurthy",
    "TEAM_LEAD",
    taasBU.id,
    newUsers.taasDM1.id,
    taasAdmin.id
  );
  await createUser(
    "taasTL2",
    "Naveen",
    "Subramanian",
    "TEAM_LEAD",
    taasBU.id,
    newUsers.taasDM1.id,
    taasAdmin.id
  );
  await createUser(
    "taasTL3",
    "Yamini",
    "Murugesan",
    "TEAM_LEAD",
    taasBU.id,
    newUsers.taasDM2.id,
    taasAdmin.id
  );

  // ── TaaS Sales ──
  await createUser(
    "taasSales1",
    "Balaji",
    "Narayanan",
    "SALES",
    taasBU.id,
    taasAdmin.id,
    taasAdmin.id
  );
  await createUser(
    "taasSales2",
    "Chithra",
    "Krishnan",
    "SALES",
    taasBU.id,
    taasAdmin.id,
    taasAdmin.id
  );
  await createUser(
    "taasSales3",
    "Dinesh",
    "Venkataraman",
    "SALES",
    taasBU.id,
    taasAdmin.id,
    taasAdmin.id
  );
  await createUser(
    "taasSales4",
    "Hema",
    "Balakrishnan",
    "SALES",
    taasBU.id,
    taasAdmin.id,
    taasAdmin.id
  );

  // ── TaaS Recruiters — Delta Team (under TL1) ──
  await createUser(
    "taasR1",
    "Mohan",
    "Ramasamy",
    "RECRUITER",
    taasBU.id,
    newUsers.taasTL1.id,
    taasAdmin.id
  );
  await createUser(
    "taasR2",
    "Pavithra",
    "Rajan",
    "RECRUITER",
    taasBU.id,
    newUsers.taasTL1.id,
    taasAdmin.id
  );
  await createUser(
    "taasR3",
    "Ganesh",
    "Sundaram",
    "RECRUITER",
    taasBU.id,
    newUsers.taasTL1.id,
    taasAdmin.id
  );
  await createUser(
    "taasR4",
    "Janani",
    "Natarajan",
    "RECRUITER",
    taasBU.id,
    newUsers.taasTL1.id,
    taasAdmin.id
  );
  await createUser(
    "taasR5",
    "Ramesh",
    "Annamalai",
    "RECRUITER",
    taasBU.id,
    newUsers.taasTL1.id,
    taasAdmin.id
  );

  // ── TaaS Recruiters — Gamma Team (under TL2) ──
  await createUser(
    "taasR6",
    "Vijaya",
    "Chandrasekaran",
    "RECRUITER",
    taasBU.id,
    newUsers.taasTL2.id,
    taasAdmin.id
  );
  await createUser(
    "taasR7",
    "Venkat",
    "Dakshinamurthy",
    "RECRUITER",
    taasBU.id,
    newUsers.taasTL2.id,
    taasAdmin.id
  );
  await createUser(
    "taasR8",
    "Padma",
    "Parthasarathy",
    "RECRUITER",
    taasBU.id,
    newUsers.taasTL2.id,
    taasAdmin.id
  );
  await createUser(
    "taasR9",
    "Murugan",
    "Subramanian",
    "RECRUITER",
    taasBU.id,
    newUsers.taasTL2.id,
    taasAdmin.id
  );
  await createUser(
    "taasR10",
    "Usha",
    "Venkataraman",
    "RECRUITER",
    taasBU.id,
    newUsers.taasTL2.id,
    taasAdmin.id
  );

  // ── TaaS Recruiters — TL3 squad ──
  await createUser(
    "taasR11",
    "Gopal",
    "Narayanan",
    "RECRUITER",
    taasBU.id,
    newUsers.taasTL3.id,
    taasAdmin.id
  );
  await createUser(
    "taasR12",
    "Sumathi",
    "Balakrishnan",
    "RECRUITER",
    taasBU.id,
    newUsers.taasTL3.id,
    taasAdmin.id
  );
  await createUser(
    "taasR13",
    "Prakash",
    "Krishnan",
    "RECRUITER",
    taasBU.id,
    newUsers.taasTL3.id,
    taasAdmin.id
  );
  await createUser(
    "taasR14",
    "Uma",
    "Raghunathan",
    "RECRUITER",
    taasBU.id,
    newUsers.taasTL3.id,
    taasAdmin.id
  );

  console.log("  ✅ TaaS: 2 DMs, 3 TLs, 14 Recruiters, 4 Sales");
  console.log("  ✅ Total new users: 55");

  // ── Team Memberships ───────────────────────────────────────────────────────
  console.log("\n🔗 Team memberships...");

  async function addMember(userId, teamId, teamRole) {
    await prisma.teamMember.upsert({
      where: { userId_teamId: { userId, teamId } },
      update: { teamRole },
      create: { userId, teamId, teamRole },
    });
  }

  // Original memberships
  await addMember(salesUser.id, kaasSalesTeam.id, "MEMBER");
  await addMember(deliveryManager.id, kaasDeliveryTeam.id, "LEAD");
  await addMember(teamLead.id, joesTeam.id, "LEAD");
  await addMember(recruiter1.id, joesTeam.id, "MEMBER");
  await addMember(recruiter2.id, joesTeam.id, "MEMBER");

  // KaaS Sales Team
  await addMember(newUsers.kaasSales2.id, kaasSalesTeam.id, "MEMBER");
  await addMember(newUsers.kaasSales3.id, kaasSalesTeam.id, "MEMBER");
  await addMember(newUsers.kaasSales4.id, kaasSalesTeam.id, "MEMBER");
  await addMember(newUsers.kaasSales5.id, kaasSalesTeam.id, "MEMBER");

  // KaaS Delivery Team leads
  await addMember(newUsers.kaasDM2.id, kaasDeliveryTeam.id, "CO_LEAD");
  await addMember(newUsers.kaasDM3.id, kaasDeliveryTeam.id, "MEMBER");

  // Alpha Squad
  await addMember(newUsers.kaasTL2.id, alphaSquad.id, "LEAD");
  await addMember(newUsers.kaasR3.id, alphaSquad.id, "MEMBER");
  await addMember(newUsers.kaasR4.id, alphaSquad.id, "MEMBER");
  await addMember(newUsers.kaasR5.id, alphaSquad.id, "MEMBER");
  await addMember(newUsers.kaasR6.id, alphaSquad.id, "MEMBER");
  await addMember(newUsers.kaasR7.id, alphaSquad.id, "MEMBER");

  // Beta Squad
  await addMember(newUsers.kaasTL3.id, betaSquad.id, "LEAD");
  await addMember(newUsers.kaasR8.id, betaSquad.id, "MEMBER");
  await addMember(newUsers.kaasR9.id, betaSquad.id, "MEMBER");
  await addMember(newUsers.kaasR10.id, betaSquad.id, "MEMBER");
  await addMember(newUsers.kaasR11.id, betaSquad.id, "MEMBER");
  await addMember(newUsers.kaasR12.id, betaSquad.id, "MEMBER");

  // KaaS TL4 sub-team inside joesTeam (expand Joe's Team)
  await addMember(newUsers.kaasTL4.id, joesTeam.id, "CO_LEAD");
  await addMember(newUsers.kaasR13.id, joesTeam.id, "MEMBER");
  await addMember(newUsers.kaasR14.id, joesTeam.id, "MEMBER");
  await addMember(newUsers.kaasR15.id, joesTeam.id, "MEMBER");
  await addMember(newUsers.kaasR16.id, joesTeam.id, "MEMBER");

  // TaaS Sales Team
  await addMember(newUsers.taasSales1.id, taasSalesTeam.id, "MEMBER");
  await addMember(newUsers.taasSales2.id, taasSalesTeam.id, "MEMBER");
  await addMember(newUsers.taasSales3.id, taasSalesTeam.id, "MEMBER");
  await addMember(newUsers.taasSales4.id, taasSalesTeam.id, "MEMBER");

  // TaaS Delivery
  await addMember(newUsers.taasDM1.id, taasDeliveryTeam.id, "LEAD");
  await addMember(newUsers.taasDM2.id, taasDeliveryTeam.id, "CO_LEAD");

  // Delta Team
  await addMember(newUsers.taasTL1.id, deltaTeam.id, "LEAD");
  await addMember(newUsers.taasR1.id, deltaTeam.id, "MEMBER");
  await addMember(newUsers.taasR2.id, deltaTeam.id, "MEMBER");
  await addMember(newUsers.taasR3.id, deltaTeam.id, "MEMBER");
  await addMember(newUsers.taasR4.id, deltaTeam.id, "MEMBER");
  await addMember(newUsers.taasR5.id, deltaTeam.id, "MEMBER");

  // Gamma Team
  await addMember(newUsers.taasTL2.id, gammaTeam.id, "LEAD");
  await addMember(newUsers.taasR6.id, gammaTeam.id, "MEMBER");
  await addMember(newUsers.taasR7.id, gammaTeam.id, "MEMBER");
  await addMember(newUsers.taasR8.id, gammaTeam.id, "MEMBER");
  await addMember(newUsers.taasR9.id, gammaTeam.id, "MEMBER");
  await addMember(newUsers.taasR10.id, gammaTeam.id, "MEMBER");

  // TL3 sub-team under Gamma
  await addMember(newUsers.taasTL3.id, gammaTeam.id, "CO_LEAD");
  await addMember(newUsers.taasR11.id, gammaTeam.id, "MEMBER");
  await addMember(newUsers.taasR12.id, gammaTeam.id, "MEMBER");
  await addMember(newUsers.taasR13.id, gammaTeam.id, "MEMBER");
  await addMember(newUsers.taasR14.id, gammaTeam.id, "MEMBER");

  console.log("  ✅ All team memberships done");

  // ── Clients ────────────────────────────────────────────────────────────────
  console.log("\n🏭 Clients...");

  const clientsData = [
    // KaaS clients
    {
      id: "seed-client-001",
      name: "Infosys BPM",
      vmsName: "Infosys BPM Ltd",
      category: "SERVICE",
      industry: "IT Services",
      state: "Karnataka",
      city: "Bangalore",
      status: "ACTIVE",
      buId: kaasBU.id,
      createdBy: salesUser.id,
      approvedBy: kaasAdmin.id,
    },
    {
      id: "seed-client-002",
      name: "Wipro Technologies",
      vmsName: "Wipro Ltd",
      category: "SERVICE",
      industry: "IT Services",
      state: "Karnataka",
      city: "Bangalore",
      status: "ACTIVE",
      buId: kaasBU.id,
      createdBy: newUsers.kaasSales2.id,
      approvedBy: kaasAdmin.id,
    },
    {
      id: "seed-client-003",
      name: "HCL Tech",
      vmsName: "HCL Technologies",
      category: "SERVICE",
      industry: "IT Services",
      state: "Tamil Nadu",
      city: "Chennai",
      status: "ACTIVE",
      buId: kaasBU.id,
      createdBy: newUsers.kaasSales3.id,
      approvedBy: kaasAdmin.id,
    },
    {
      id: "seed-client-004",
      name: "Mphasis Limited",
      vmsName: "Mphasis",
      category: "CONSULTING",
      industry: "BFSI Tech",
      state: "Karnataka",
      city: "Bangalore",
      status: "PENDING",
      buId: kaasBU.id,
      createdBy: newUsers.kaasSales4.id,
      approvedBy: null,
    },
    // TaaS clients
    {
      id: "seed-client-005",
      name: "TCS Digital",
      vmsName: "Tata Consultancy Services",
      category: "SERVICE",
      industry: "IT Consulting",
      state: "Maharashtra",
      city: "Mumbai",
      status: "ACTIVE",
      buId: taasBU.id,
      createdBy: newUsers.taasSales1.id,
      approvedBy: taasAdmin.id,
    },
    {
      id: "seed-client-006",
      name: "Cognizant India",
      vmsName: "Cognizant Technology Solutions",
      category: "SERVICE",
      industry: "IT Services",
      state: "Tamil Nadu",
      city: "Chennai",
      status: "ACTIVE",
      buId: taasBU.id,
      createdBy: newUsers.taasSales2.id,
      approvedBy: taasAdmin.id,
    },
    {
      id: "seed-client-007",
      name: "LTIMindtree",
      vmsName: "LTIMindtree Ltd",
      category: "CONSULTING",
      industry: "Digital Transformation",
      state: "Maharashtra",
      city: "Pune",
      status: "ACTIVE",
      buId: taasBU.id,
      createdBy: newUsers.taasSales3.id,
      approvedBy: taasAdmin.id,
    },
    {
      id: "seed-client-008",
      name: "Persistent Systems",
      vmsName: "Persistent Systems Ltd",
      category: "PRODUCT",
      industry: "SaaS",
      state: "Maharashtra",
      city: "Pune",
      status: "INACTIVE",
      buId: taasBU.id,
      createdBy: newUsers.taasSales4.id,
      approvedBy: taasAdmin.id,
    },
  ];

  const clients = {};
  for (const c of clientsData) {
    const client = await prisma.clientClient.upsert({
      where: { id: c.id },
      update: {},
      create: {
        id: c.id,
        name: c.name,
        vmsName: c.vmsName,
        category: c.category,
        industry: c.industry,
        country: "India",
        state: c.state,
        city: c.city,
        status: c.status,
        businessUnitId: c.buId,
        createdById: c.createdBy,
        ...(c.approvedBy
          ? { approvedById: c.approvedBy, approvedAt: daysAgo(randInt(10, 60)) }
          : {}),
      },
    });
    clients[c.id] = client;
  }

  // Handlers
  for (const [clientId, salesUserId, assignedBy] of [
    ["seed-client-001", salesUser.id, kaasAdmin.id],
    ["seed-client-002", newUsers.kaasSales2.id, kaasAdmin.id],
    ["seed-client-003", newUsers.kaasSales3.id, kaasAdmin.id],
    ["seed-client-004", newUsers.kaasSales4.id, kaasAdmin.id],
    ["seed-client-005", newUsers.taasSales1.id, taasAdmin.id],
    ["seed-client-006", newUsers.taasSales2.id, taasAdmin.id],
    ["seed-client-007", newUsers.taasSales3.id, taasAdmin.id],
    ["seed-client-008", newUsers.taasSales4.id, taasAdmin.id],
  ]) {
    await prisma.clientHandler.upsert({
      where: { clientId_userId: { clientId, userId: salesUserId } },
      update: {},
      create: {
        clientId,
        userId: salesUserId,
        role: "PRIMARY",
        assignedById: assignedBy,
      },
    });
  }

  // Team assignments
  for (const [clientId, teamId, assignedBy] of [
    ["seed-client-001", kaasDeliveryTeam.id, kaasAdmin.id],
    ["seed-client-002", alphaSquad.id, kaasAdmin.id],
    ["seed-client-003", betaSquad.id, kaasAdmin.id],
    ["seed-client-005", taasDeliveryTeam.id, taasAdmin.id],
    ["seed-client-006", deltaTeam.id, taasAdmin.id],
    ["seed-client-007", gammaTeam.id, taasAdmin.id],
  ]) {
    await prisma.clientTeamAssignment.upsert({
      where: { clientId_teamId: { clientId, teamId } },
      update: {},
      create: { clientId, teamId, assignedById: assignedBy },
    });
  }

  console.log("  ✅ 8 clients with handlers and team assignments");

  // ── Requirements — 25 total ────────────────────────────────────────────────
  console.log("\n📝 Requirements (25)...");

  const REQ_DEFINITIONS = [
    // KaaS — Infosys BPM
    {
      code: "SFJ-R-10001",
      title: "Senior Java Developer",
      client: "seed-client-001",
      bu: kaasBU.id,
      jobType: "CONTRACT",
      remoteType: "HYBRID",
      priority: "HIGH",
      openings: 3,
      salMin: 800000,
      salMax: 1400000,
      status: "ACTIVE",
      createdBy: salesUser.id,
      approvedBy: kaasAdmin.id,
      daysAgoCreated: 45,
    },
    {
      code: "SFJ-R-10002",
      title: "React Frontend Engineer",
      client: "seed-client-001",
      bu: kaasBU.id,
      jobType: "PERMANENT",
      remoteType: "REMOTE",
      priority: "MEDIUM",
      openings: 2,
      salMin: 900000,
      salMax: 1600000,
      status: "ACTIVE",
      createdBy: salesUser.id,
      approvedBy: kaasAdmin.id,
      daysAgoCreated: 38,
    },
    {
      code: "SFJ-R-10003",
      title: "DevOps Engineer (AWS)",
      client: "seed-client-001",
      bu: kaasBU.id,
      jobType: "CONTRACT",
      remoteType: "ONSITE",
      priority: "HIGH",
      openings: 1,
      salMin: 1000000,
      salMax: 1800000,
      status: "ACTIVE",
      createdBy: salesUser.id,
      approvedBy: kaasAdmin.id,
      daysAgoCreated: 30,
    },
    // KaaS — Wipro
    {
      code: "SFJ-R-10004",
      title: "Python Data Engineer",
      client: "seed-client-002",
      bu: kaasBU.id,
      jobType: "CONTRACT",
      remoteType: "HYBRID",
      priority: "HIGH",
      openings: 4,
      salMin: 700000,
      salMax: 1300000,
      status: "ACTIVE",
      createdBy: newUsers.kaasSales2.id,
      approvedBy: kaasAdmin.id,
      daysAgoCreated: 28,
    },
    {
      code: "SFJ-R-10005",
      title: "Scrum Master",
      client: "seed-client-002",
      bu: kaasBU.id,
      jobType: "CONTRACT_TO_HIRE",
      remoteType: "HYBRID",
      priority: "LOW",
      openings: 1,
      salMin: 600000,
      salMax: 900000,
      status: "PENDING_APPROVAL",
      createdBy: newUsers.kaasSales2.id,
      approvedBy: null,
      daysAgoCreated: 10,
    },
    {
      code: "SFJ-R-10006",
      title: "SAP FICO Consultant",
      client: "seed-client-002",
      bu: kaasBU.id,
      jobType: "PERMANENT",
      remoteType: "ONSITE",
      priority: "MEDIUM",
      openings: 2,
      salMin: 1200000,
      salMax: 2000000,
      status: "ACTIVE",
      createdBy: newUsers.kaasSales2.id,
      approvedBy: kaasAdmin.id,
      daysAgoCreated: 55,
    },
    {
      code: "SFJ-R-10007",
      title: "QA Automation Engineer",
      client: "seed-client-002",
      bu: kaasBU.id,
      jobType: "CONTRACT",
      remoteType: "REMOTE",
      priority: "MEDIUM",
      openings: 3,
      salMin: 500000,
      salMax: 900000,
      status: "ON_HOLD",
      createdBy: newUsers.kaasSales3.id,
      approvedBy: kaasAdmin.id,
      daysAgoCreated: 60,
    },
    // KaaS — HCL
    {
      code: "SFJ-R-10008",
      title: "Node.js Backend Developer",
      client: "seed-client-003",
      bu: kaasBU.id,
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      priority: "HIGH",
      openings: 5,
      salMin: 800000,
      salMax: 1500000,
      status: "ACTIVE",
      createdBy: newUsers.kaasSales3.id,
      approvedBy: kaasAdmin.id,
      daysAgoCreated: 20,
    },
    {
      code: "SFJ-R-10009",
      title: "Cloud Architect (Azure)",
      client: "seed-client-003",
      bu: kaasBU.id,
      jobType: "CONTRACT",
      remoteType: "ONSITE",
      priority: "HIGH",
      openings: 1,
      salMin: 2000000,
      salMax: 3500000,
      status: "ACTIVE",
      createdBy: newUsers.kaasSales3.id,
      approvedBy: kaasAdmin.id,
      daysAgoCreated: 15,
    },
    {
      code: "SFJ-R-10010",
      title: "Business Analyst",
      client: "seed-client-003",
      bu: kaasBU.id,
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      priority: "LOW",
      openings: 2,
      salMin: 600000,
      salMax: 1000000,
      status: "CLOSED",
      createdBy: newUsers.kaasSales3.id,
      approvedBy: kaasAdmin.id,
      daysAgoCreated: 90,
    },
    // KaaS — Mphasis (pending approval)
    {
      code: "SFJ-R-10011",
      title: "Full Stack Developer (MERN)",
      client: "seed-client-004",
      bu: kaasBU.id,
      jobType: "CONTRACT_TO_HIRE",
      remoteType: "HYBRID",
      priority: "MEDIUM",
      openings: 3,
      salMin: 900000,
      salMax: 1600000,
      status: "DRAFT",
      createdBy: newUsers.kaasSales4.id,
      approvedBy: null,
      daysAgoCreated: 5,
    },
    {
      code: "SFJ-R-10012",
      title: "Security Engineer",
      client: "seed-client-004",
      bu: kaasBU.id,
      jobType: "PERMANENT",
      remoteType: "ONSITE",
      priority: "HIGH",
      openings: 1,
      salMin: 1500000,
      salMax: 2500000,
      status: "CANCELLED",
      createdBy: newUsers.kaasSales4.id,
      approvedBy: kaasAdmin.id,
      daysAgoCreated: 80,
    },
    // TaaS — TCS
    {
      code: "SFJ-R-20001",
      title: "Golang Backend Engineer",
      client: "seed-client-005",
      bu: taasBU.id,
      jobType: "CONTRACT",
      remoteType: "REMOTE",
      priority: "HIGH",
      openings: 3,
      salMin: 1200000,
      salMax: 2000000,
      status: "ACTIVE",
      createdBy: newUsers.taasSales1.id,
      approvedBy: taasAdmin.id,
      daysAgoCreated: 25,
    },
    {
      code: "SFJ-R-20002",
      title: "Kubernetes Platform Engineer",
      client: "seed-client-005",
      bu: taasBU.id,
      jobType: "CONTRACT",
      remoteType: "HYBRID",
      priority: "HIGH",
      openings: 2,
      salMin: 1500000,
      salMax: 2500000,
      status: "ACTIVE",
      createdBy: newUsers.taasSales1.id,
      approvedBy: taasAdmin.id,
      daysAgoCreated: 22,
    },
    {
      code: "SFJ-R-20003",
      title: "Data Scientist (ML)",
      client: "seed-client-005",
      bu: taasBU.id,
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      priority: "MEDIUM",
      openings: 2,
      salMin: 1000000,
      salMax: 1800000,
      status: "ACTIVE",
      createdBy: newUsers.taasSales2.id,
      approvedBy: taasAdmin.id,
      daysAgoCreated: 18,
    },
    {
      code: "SFJ-R-20004",
      title: "Salesforce Developer",
      client: "seed-client-005",
      bu: taasBU.id,
      jobType: "CONTRACT_TO_HIRE",
      remoteType: "ONSITE",
      priority: "LOW",
      openings: 1,
      salMin: 800000,
      salMax: 1400000,
      status: "PENDING_APPROVAL",
      createdBy: newUsers.taasSales2.id,
      approvedBy: null,
      daysAgoCreated: 7,
    },
    // TaaS — Cognizant
    {
      code: "SFJ-R-20005",
      title: "SAP S/4 HANA Consultant",
      client: "seed-client-006",
      bu: taasBU.id,
      jobType: "CONTRACT",
      remoteType: "ONSITE",
      priority: "HIGH",
      openings: 4,
      salMin: 1500000,
      salMax: 2800000,
      status: "ACTIVE",
      createdBy: newUsers.taasSales2.id,
      approvedBy: taasAdmin.id,
      daysAgoCreated: 40,
    },
    {
      code: "SFJ-R-20006",
      title: "Oracle DBA",
      client: "seed-client-006",
      bu: taasBU.id,
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      priority: "MEDIUM",
      openings: 2,
      salMin: 900000,
      salMax: 1600000,
      status: "ACTIVE",
      createdBy: newUsers.taasSales3.id,
      approvedBy: taasAdmin.id,
      daysAgoCreated: 35,
    },
    {
      code: "SFJ-R-20007",
      title: "Tableau BI Developer",
      client: "seed-client-006",
      bu: taasBU.id,
      jobType: "CONTRACT",
      remoteType: "REMOTE",
      priority: "LOW",
      openings: 1,
      salMin: 700000,
      salMax: 1100000,
      status: "ON_HOLD",
      createdBy: newUsers.taasSales3.id,
      approvedBy: taasAdmin.id,
      daysAgoCreated: 50,
    },
    // TaaS — LTIMindtree
    {
      code: "SFJ-R-20008",
      title: "Angular Developer (v16+)",
      client: "seed-client-007",
      bu: taasBU.id,
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      priority: "MEDIUM",
      openings: 3,
      salMin: 800000,
      salMax: 1400000,
      status: "ACTIVE",
      createdBy: newUsers.taasSales4.id,
      approvedBy: taasAdmin.id,
      daysAgoCreated: 14,
    },
    {
      code: "SFJ-R-20009",
      title: "Java Microservices Architect",
      client: "seed-client-007",
      bu: taasBU.id,
      jobType: "CONTRACT",
      remoteType: "ONSITE",
      priority: "HIGH",
      openings: 1,
      salMin: 2500000,
      salMax: 4000000,
      status: "ACTIVE",
      createdBy: newUsers.taasSales4.id,
      approvedBy: taasAdmin.id,
      daysAgoCreated: 12,
    },
    {
      code: "SFJ-R-20010",
      title: "Product Manager (FinTech)",
      client: "seed-client-007",
      bu: taasBU.id,
      jobType: "PERMANENT",
      remoteType: "REMOTE",
      priority: "MEDIUM",
      openings: 1,
      salMin: 1800000,
      salMax: 3000000,
      status: "CLOSED",
      createdBy: newUsers.taasSales1.id,
      approvedBy: taasAdmin.id,
      daysAgoCreated: 95,
    },
    // TaaS — Persistent (inactive client, cancelled reqs)
    {
      code: "SFJ-R-20011",
      title: "Embedded C Engineer",
      client: "seed-client-008",
      bu: taasBU.id,
      jobType: "PERMANENT",
      remoteType: "ONSITE",
      priority: "LOW",
      openings: 2,
      salMin: 600000,
      salMax: 1000000,
      status: "CANCELLED",
      createdBy: newUsers.taasSales1.id,
      approvedBy: taasAdmin.id,
      daysAgoCreated: 100,
    },
    {
      code: "SFJ-R-20012",
      title: "VLSI Design Engineer",
      client: "seed-client-008",
      bu: taasBU.id,
      jobType: "PERMANENT",
      remoteType: "ONSITE",
      priority: "MEDIUM",
      openings: 1,
      salMin: 800000,
      salMax: 1400000,
      status: "DRAFT",
      createdBy: newUsers.taasSales2.id,
      approvedBy: null,
      daysAgoCreated: 3,
    },
    // Extra mixed
    {
      code: "SFJ-R-10013",
      title: "Technical Writer",
      client: "seed-client-003",
      bu: kaasBU.id,
      jobType: "FREELANCE",
      remoteType: "REMOTE",
      priority: "LOW",
      openings: 1,
      salMin: 300000,
      salMax: 600000,
      status: "ACTIVE",
      createdBy: salesUser.id,
      approvedBy: kaasAdmin.id,
      daysAgoCreated: 8,
    },
    {
      code: "SFJ-R-20013",
      title: "Agile Coach",
      client: "seed-client-006",
      bu: taasBU.id,
      jobType: "CONTRACT_TO_HIRE",
      remoteType: "HYBRID",
      priority: "MEDIUM",
      openings: 1,
      salMin: 1200000,
      salMax: 2000000,
      status: "ACTIVE",
      createdBy: newUsers.taasSales3.id,
      approvedBy: taasAdmin.id,
      daysAgoCreated: 6,
    },
  ];

  const requirements = {};
  for (const r of REQ_DEFINITIONS) {
    const createdAt = daysAgo(r.daysAgoCreated);
    const req = await prisma.requirement.upsert({
      where: { reqCode: r.code },
      update: {},
      create: {
        reqCode: r.code,
        title: r.title,
        clientId: r.client,
        businessUnitId: r.bu,
        jobType: r.jobType,
        remoteType: r.remoteType,
        priority: r.priority,
        totalOpenings: r.openings,
        salaryMin: r.salMin,
        salaryMax: r.salMax,
        salaryType: "ANNUAL",
        status: r.status,
        createdById: r.createdBy,
        ...(r.approvedBy
          ? {
              approvedById: r.approvedBy,
              approvedAt: daysAgo(r.daysAgoCreated - 2),
            }
          : {}),
        ...(r.status === "CLOSED" || r.status === "CANCELLED"
          ? { closedAt: daysAgo(randInt(1, 10)) }
          : {}),
        location: r.bu === kaasBU.id ? "Bangalore" : "Chennai",
        country: "India",
        createdAt,
      },
    });
    requirements[r.code] = req;
  }

  // Skills on requirements
  const SKILL_SETS = {
    "SFJ-R-10001": [
      ["Java", true],
      ["Spring Boot", true],
      ["Microservices", true],
      ["Docker", false],
      ["Kafka", false],
    ],
    "SFJ-R-10002": [
      ["React", true],
      ["TypeScript", true],
      ["Next.js", false],
      ["Tailwind CSS", false],
    ],
    "SFJ-R-10003": [
      ["AWS", true],
      ["Terraform", true],
      ["CI/CD", true],
      ["Kubernetes", false],
    ],
    "SFJ-R-10004": [
      ["Python", true],
      ["Spark", true],
      ["Airflow", false],
      ["SQL", true],
    ],
    "SFJ-R-10008": [
      ["Node.js", true],
      ["Express", true],
      ["PostgreSQL", true],
      ["Redis", false],
    ],
    "SFJ-R-10009": [
      ["Azure", true],
      ["AKS", true],
      ["ARM Templates", true],
      ["Bicep", false],
    ],
    "SFJ-R-20001": [
      ["Golang", true],
      ["gRPC", true],
      ["PostgreSQL", true],
      ["Redis", false],
    ],
    "SFJ-R-20002": [
      ["Kubernetes", true],
      ["Helm", true],
      ["ArgoCD", false],
      ["Prometheus", false],
    ],
    "SFJ-R-20003": [
      ["Python", true],
      ["TensorFlow", true],
      ["MLflow", false],
      ["SQL", true],
    ],
    "SFJ-R-20005": [
      ["SAP S/4 HANA", true],
      ["ABAP", true],
      ["FICO", true],
      ["SD", false],
    ],
    "SFJ-R-20009": [
      ["Java", true],
      ["Spring Cloud", true],
      ["Kafka", true],
      ["AWS", false],
    ],
  };

  for (const [code, skills] of Object.entries(SKILL_SETS)) {
    const req = requirements[code];
    if (!req) continue;
    const existing = await prisma.requirementSkill.count({
      where: { requirementId: req.id },
    });
    if (existing === 0) {
      await prisma.requirementSkill.createMany({
        data: skills.map(([skill, isMandatory]) => ({
          requirementId: req.id,
          skill,
          isMandatory,
        })),
      });
    }
  }

  console.log("  ✅ 25 requirements with skills");

  // ── Assignment chains for ACTIVE requirements ──────────────────────────────
  console.log("\n🔗 Assignment chains...");

  // Map: reqCode → { dm, team, tl, recruiters[] }
  const assignmentMap = [
    {
      code: "SFJ-R-10001",
      dm: deliveryManager,
      team: joesTeam,
      tl: teamLead,
      recruiters: [recruiter1, recruiter2],
      adminAssigner: kaasAdmin,
    },
    {
      code: "SFJ-R-10002",
      dm: deliveryManager,
      team: joesTeam,
      tl: teamLead,
      recruiters: [recruiter1],
      adminAssigner: kaasAdmin,
    },
    {
      code: "SFJ-R-10003",
      dm: newUsers.kaasDM2,
      team: alphaSquad,
      tl: newUsers.kaasTL2,
      recruiters: [newUsers.kaasR3, newUsers.kaasR4],
      adminAssigner: kaasAdmin,
    },
    {
      code: "SFJ-R-10004",
      dm: newUsers.kaasDM2,
      team: alphaSquad,
      tl: newUsers.kaasTL2,
      recruiters: [newUsers.kaasR5, newUsers.kaasR6, newUsers.kaasR7],
      adminAssigner: kaasAdmin,
    },
    {
      code: "SFJ-R-10006",
      dm: newUsers.kaasDM3,
      team: betaSquad,
      tl: newUsers.kaasTL3,
      recruiters: [newUsers.kaasR8, newUsers.kaasR9],
      adminAssigner: kaasAdmin,
    },
    {
      code: "SFJ-R-10008",
      dm: newUsers.kaasDM3,
      team: betaSquad,
      tl: newUsers.kaasTL3,
      recruiters: [newUsers.kaasR10, newUsers.kaasR11, newUsers.kaasR12],
      adminAssigner: kaasAdmin,
    },
    {
      code: "SFJ-R-10009",
      dm: newUsers.kaasDM2,
      team: alphaSquad,
      tl: newUsers.kaasTL2,
      recruiters: [newUsers.kaasR3],
      adminAssigner: kaasAdmin,
    },
    {
      code: "SFJ-R-10013",
      dm: deliveryManager,
      team: joesTeam,
      tl: newUsers.kaasTL4,
      recruiters: [newUsers.kaasR13],
      adminAssigner: kaasAdmin,
    },
    {
      code: "SFJ-R-20001",
      dm: newUsers.taasDM1,
      team: deltaTeam,
      tl: newUsers.taasTL1,
      recruiters: [newUsers.taasR1, newUsers.taasR2],
      adminAssigner: taasAdmin,
    },
    {
      code: "SFJ-R-20002",
      dm: newUsers.taasDM1,
      team: deltaTeam,
      tl: newUsers.taasTL1,
      recruiters: [newUsers.taasR3, newUsers.taasR4],
      adminAssigner: taasAdmin,
    },
    {
      code: "SFJ-R-20003",
      dm: newUsers.taasDM2,
      team: gammaTeam,
      tl: newUsers.taasTL2,
      recruiters: [newUsers.taasR6, newUsers.taasR7],
      adminAssigner: taasAdmin,
    },
    {
      code: "SFJ-R-20005",
      dm: newUsers.taasDM1,
      team: deltaTeam,
      tl: newUsers.taasTL1,
      recruiters: [newUsers.taasR1, newUsers.taasR2, newUsers.taasR5],
      adminAssigner: taasAdmin,
    },
    {
      code: "SFJ-R-20006",
      dm: newUsers.taasDM2,
      team: gammaTeam,
      tl: newUsers.taasTL3,
      recruiters: [newUsers.taasR11, newUsers.taasR12],
      adminAssigner: taasAdmin,
    },
    {
      code: "SFJ-R-20008",
      dm: newUsers.taasDM2,
      team: gammaTeam,
      tl: newUsers.taasTL2,
      recruiters: [newUsers.taasR8, newUsers.taasR9],
      adminAssigner: taasAdmin,
    },
    {
      code: "SFJ-R-20009",
      dm: newUsers.taasDM1,
      team: deltaTeam,
      tl: newUsers.taasTL1,
      recruiters: [newUsers.taasR3],
      adminAssigner: taasAdmin,
    },
    {
      code: "SFJ-R-20013",
      dm: newUsers.taasDM2,
      team: gammaTeam,
      tl: newUsers.taasTL3,
      recruiters: [newUsers.taasR13, newUsers.taasR14],
      adminAssigner: taasAdmin,
    },
  ];

  for (const a of assignmentMap) {
    const req = requirements[a.code];
    if (!req) continue;

    const existing = await prisma.requirementAssignment.count({
      where: { requirementId: req.id },
    });
    if (existing > 0) continue;

    const managerAssignment = await prisma.requirementAssignment.create({
      data: {
        requirementId: req.id,
        assignmentType: "MANAGER",
        recruiterId: a.dm.id,
        allocatedOpenings: req.totalOpenings,
        assignedById: a.adminAssigner.id,
        status: "ACTIVE",
      },
    });

    const teamAssignment = await prisma.requirementAssignment.create({
      data: {
        requirementId: req.id,
        assignmentType: "TEAM",
        teamId: a.team.id,
        allocatedOpenings: req.totalOpenings,
        assignedById: a.dm.id,
        parentAssignmentId: managerAssignment.id,
        status: "ACTIVE",
      },
    });

    const perRecruiter = Math.ceil(req.totalOpenings / a.recruiters.length);
    for (const recruiter of a.recruiters) {
      await prisma.requirementAssignment.create({
        data: {
          requirementId: req.id,
          assignmentType: "INDIVIDUAL",
          recruiterId: recruiter.id,
          allocatedOpenings: perRecruiter,
          assignedById: a.tl.id,
          parentAssignmentId: teamAssignment.id,
          status: "ACTIVE",
        },
      });
    }
  }

  console.log("  ✅ Assignment chains for 16 active requirements");

  // ── Status histories ───────────────────────────────────────────────────────
  console.log("\n📜 Status histories...");

  const statusFlows = {
    ACTIVE: [
      ["DRAFT", "PENDING_APPROVAL"],
      ["PENDING_APPROVAL", "ACTIVE"],
    ],
    ON_HOLD: [
      ["DRAFT", "PENDING_APPROVAL"],
      ["PENDING_APPROVAL", "ACTIVE"],
      ["ACTIVE", "ON_HOLD"],
    ],
    CLOSED: [
      ["DRAFT", "PENDING_APPROVAL"],
      ["PENDING_APPROVAL", "ACTIVE"],
      ["ACTIVE", "CLOSED"],
    ],
    CANCELLED: [
      ["DRAFT", "PENDING_APPROVAL"],
      ["PENDING_APPROVAL", "ACTIVE"],
      ["ACTIVE", "CANCELLED"],
    ],
    PENDING_APPROVAL: [["DRAFT", "PENDING_APPROVAL"]],
    DRAFT: [],
  };

  for (const rDef of REQ_DEFINITIONS) {
    const req = requirements[rDef.code];
    if (!req) continue;
    const existing = await prisma.requirementStatusHistory.count({
      where: { requirementId: req.id },
    });
    if (existing > 0) continue;

    const flow = statusFlows[rDef.status] ?? [];
    for (let i = 0; i < flow.length; i++) {
      const [from, to] = flow[i];
      const changer =
        to === "ACTIVE" ? rDef.approvedBy ?? rDef.createdBy : rDef.createdBy;
      await prisma.requirementStatusHistory.create({
        data: {
          requirementId: req.id,
          fromStatus: from,
          toStatus: to,
          changedById: changer,
          reason:
            to === "ACTIVE"
              ? "Approved and activated"
              : to === "ON_HOLD"
              ? "Client requested hold"
              : to === "CANCELLED"
              ? "Requirement withdrawn by client"
              : null,
          changedAt: daysAgo(rDef.daysAgoCreated - i * 3),
        },
      });
    }
  }

  console.log("  ✅ Status histories created");

  // ── Activity feed ──────────────────────────────────────────────────────────
  console.log("\n📡 Activity feeds...");

  for (const rDef of REQ_DEFINITIONS) {
    const req = requirements[rDef.code];
    if (!req) continue;
    const existing = await prisma.requirementActivity.count({
      where: { requirementId: req.id },
    });
    if (existing > 0) continue;

    const acts = [
      {
        actorId: rDef.createdBy,
        type: "REQUIREMENT_CREATED",
        summary: `Requirement ${rDef.code} created`,
        createdAt: daysAgo(rDef.daysAgoCreated),
      },
    ];
    if (rDef.approvedBy) {
      acts.push({
        actorId: rDef.approvedBy,
        type: "REQUIREMENT_APPROVED",
        summary: `Requirement ${rDef.code} approved`,
        createdAt: daysAgo(rDef.daysAgoCreated - 2),
      });
    }
    if (rDef.status === "CLOSED") {
      acts.push({
        actorId: rDef.approvedBy ?? rDef.createdBy,
        type: "REQUIREMENT_CLOSED",
        summary: "Requirement closed — all positions filled",
        createdAt: daysAgo(3),
      });
    }

    await prisma.requirementActivity.createMany({
      data: acts.map((a) => ({ requirementId: req.id, ...a })),
    });
  }

  console.log("  ✅ Activity feeds created");

  // ── Notes ──────────────────────────────────────────────────────────────────
  console.log("\n📝 Notes...");

  const noteTemplates = [
    "Client confirmed headcount. Looking for immediate joiners.",
    "Budget approved by finance team. Proceed with sourcing.",
    "Requirement on hold pending client org restructure.",
    "Strong preference for candidates from product companies.",
    "Hybrid — 3 days onsite in Bangalore office.",
    "Notice period max 30 days, negotiable for exceptional profiles.",
  ];

  const notedReqs = [
    "SFJ-R-10001",
    "SFJ-R-10002",
    "SFJ-R-10004",
    "SFJ-R-10008",
    "SFJ-R-20001",
    "SFJ-R-20005",
    "SFJ-R-20009",
  ];
  for (const code of notedReqs) {
    const req = requirements[code];
    if (!req) continue;
    const existing = await prisma.requirementNote.count({
      where: { requirementId: req.id },
    });
    if (existing > 0) continue;

    await prisma.requirementNote.create({
      data: {
        requirementId: req.id,
        authorId:
          REQ_DEFINITIONS.find((r) => r.code === code)?.createdBy ??
          salesUser.id,
        content: pick(noteTemplates),
      },
    });
  }

  console.log("  ✅ Notes added");

  // ── Print summary ──────────────────────────────────────────────────────────
  console.log("\n🎉 Seed complete!\n");
  console.log(
    "┌─────────────────────────────────────────────────────────────────────┐"
  );
  console.log(
    "│  DATASET SUMMARY                                                    │"
  );
  console.log(
    "├─────────────────────────────────────────────────────────────────────┤"
  );
  console.log(
    "│  Business Units    2  (KaaS, TaaS)                                  │"
  );
  console.log(
    "│  Teams            11  (5 KaaS + 4 TaaS + 2 roots)                   │"
  );
  console.log(
    "│  Users            63  (8 original + 55 new)                         │"
  );
  console.log(
    "│  Clients           8  (4 KaaS, 4 TaaS)                              │"
  );
  console.log(
    "│  Requirements     25  (13 KaaS, 12 TaaS)                            │"
  );
  console.log(
    "│  Assignments      ~48 chains (MANAGER→TEAM→INDIVIDUAL)              │"
  );
  console.log(
    "├─────────────────────────────────────────────────────────────────────┤"
  );
  console.log(
    "│  KaaS logins                                                        │"
  );
  console.log(
    "│  admin.kaas@talentos.com      Admin@123  ADMIN                      │"
  );
  console.log(
    "│  dm.kaas@talentos.com         Pass@123   DELIVERY_MANAGER           │"
  );
  console.log(
    "│  tl.kaas@talentos.com         Pass@123   TEAM_LEAD (Joe's Team)     │"
  );
  console.log(
    "│  ritu@talentos.com            Pass@123   RECRUITER                  │"
  );
  console.log(
    "│  karan@talentos.com           Pass@123   RECRUITER                  │"
  );
  console.log(
    "│  sales1@talentos.com          Pass@123   SALES                      │"
  );
  console.log(
    "├─────────────────────────────────────────────────────────────────────┤"
  );
  console.log(
    "│  TaaS logins                                                        │"
  );
  console.log(
    "│  admin.taas@talentos.com      Admin@123  ADMIN                      │"
  );
  console.log(
    "│  superadmin@talentos.com      Admin@123  SUPER_ADMIN                │"
  );
  console.log(
    "└─────────────────────────────────────────────────────────────────────┘"
  );
  console.log("\n  KaaS Team Tree:");
  console.log("    KaaS Ecosystem (MANAGEMENT)");
  console.log("      ├── KaaS Sales Team       → Sneha + 4 sales");
  console.log("      └── KaaS Delivery Team    → Papitha (LEAD)");
  console.log(
    "            ├── Joe's Team       → Joe (LEAD) + Ritu + Karan + TL4 squad"
  );
  console.log(
    "            ├── Alpha Squad      → Ananya (LEAD) + 5 recruiters"
  );
  console.log(
    "            └── Beta Squad       → Vikram (LEAD) + 5 recruiters"
  );
  console.log("\n  TaaS Team Tree:");
  console.log("    TaaS Ecosystem (MANAGEMENT)");
  console.log("      ├── TaaS Sales Team       → 4 sales");
  console.log("      └── TaaS Delivery Team    → Karthik + Revathi");
  console.log("            ├── Delta Team       → Varun (LEAD) + 5 recruiters");
  console.log(
    "            └── Gamma Team       → Naveen + Yamini + 9 recruiters"
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
