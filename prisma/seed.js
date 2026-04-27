// prisma/seed.js
// Fresh seed — written against the final schema.
// All UUIDs are hardcoded so the seed is fully idempotent.
// Safe to run multiple times.

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();
const hash = (p) => bcrypt.hashSync(p, 10);

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// ─────────────────────────────────────────
// HARDCODED UUIDs — every entity has a stable ID
// ─────────────────────────────────────────

const ID = {
  // Roles
  role: {
    superAdmin: "role-0001-0000-0000-000000000001",
    admin: "role-0002-0000-0000-000000000002",
    deliveryManager: "role-0003-0000-0000-000000000003",
    teamLead: "role-0004-0000-0000-000000000004",
    recruiter: "role-0005-0000-0000-000000000005",
    sales: "role-0006-0000-0000-000000000006",
  },

  // Business Units
  bu: {
    kaas: "bu000001-0000-0000-0000-000000000001",
    taas: "bu000002-0000-0000-0000-000000000002",
  },

  // Users — KaaS
  user: {
    superAdmin: "user0001-0000-0000-0000-000000000001",
    kaasAdmin: "user0002-0000-0000-0000-000000000002",
    taasAdmin: "user0003-0000-0000-0000-000000000003",
    kaasDM1: "user0004-0000-0000-0000-000000000004", // Papitha Raj
    kaasDM2: "user0005-0000-0000-0000-000000000005", // Nandini Krishnan
    kaasDM3: "user0006-0000-0000-0000-000000000006", // Suresh Balakrishnan
    kaasTL1: "user0007-0000-0000-0000-000000000007", // Joe Thomas
    kaasTL2: "user0008-0000-0000-0000-000000000008", // Ananya Reddy
    kaasTL3: "user0009-0000-0000-0000-000000000009", // Vikram Patel
    kaasTL4: "user0010-0000-0000-0000-000000000010", // Divya Sharma
    kaasSales1: "user0011-0000-0000-0000-000000000011", // Sneha Pillai
    kaasSales2: "user0012-0000-0000-0000-000000000012", // Rohan Joshi
    kaasSales3: "user0013-0000-0000-0000-000000000013", // Kavya Rao
    kaasSales4: "user0014-0000-0000-0000-000000000014", // Aakash Shetty
    kaasSales5: "user0015-0000-0000-0000-000000000015", // Meera Kamath
    kaasR1: "user0016-0000-0000-0000-000000000016", // Ritu Verma
    kaasR2: "user0017-0000-0000-0000-000000000017", // Karan Nair
    kaasR3: "user0018-0000-0000-0000-000000000018", // Arjun Kumar
    kaasR4: "user0019-0000-0000-0000-000000000019", // Pooja Iyer
    kaasR5: "user0020-0000-0000-0000-000000000020", // Rahul Menon
    kaasR6: "user0021-0000-0000-0000-000000000021", // Swathi Nair
    kaasR7: "user0022-0000-0000-0000-000000000022", // Ajay Pillai
    kaasR8: "user0023-0000-0000-0000-000000000023", // Harish Venkat
    kaasR9: "user0024-0000-0000-0000-000000000024", // Lakshmi Ganesan
    kaasR10: "user0025-0000-0000-0000-000000000025", // Sanjay Ramasamy
    kaasR11: "user0026-0000-0000-0000-000000000026", // Asha Natarajan
    kaasR12: "user0027-0000-0000-0000-000000000027", // Vinod Rajan
    kaasR13: "user0028-0000-0000-0000-000000000028", // Geetha Sundaram
    kaasR14: "user0029-0000-0000-0000-000000000029", // Nikhil Raghunathan
    // TaaS
    taasDM1: "user0030-0000-0000-0000-000000000030", // Karthik Subramaniam
    taasDM2: "user0031-0000-0000-0000-000000000031", // Revathi Parthasarathy
    taasTL1: "user0032-0000-0000-0000-000000000032", // Varun Dakshinamurthy
    taasTL2: "user0033-0000-0000-0000-000000000033", // Naveen Subramanian
    taasTL3: "user0034-0000-0000-0000-000000000034", // Yamini Murugesan
    taasSales1: "user0035-0000-0000-0000-000000000035", // Balaji Narayanan
    taasSales2: "user0036-0000-0000-0000-000000000036", // Chithra Krishnan
    taasSales3: "user0037-0000-0000-0000-000000000037", // Dinesh Venkataraman
    taasSales4: "user0038-0000-0000-0000-000000000038", // Hema Balakrishnan
    taasR1: "user0039-0000-0000-0000-000000000039", // Mohan Ramasamy
    taasR2: "user0040-0000-0000-0000-000000000040", // Pavithra Rajan
    taasR3: "user0041-0000-0000-0000-000000000041", // Ganesh Sundaram
    taasR4: "user0042-0000-0000-0000-000000000042", // Janani Natarajan
    taasR5: "user0043-0000-0000-0000-000000000043", // Ramesh Annamalai
    taasR6: "user0044-0000-0000-0000-000000000044", // Vijaya Chandrasekaran
    taasR7: "user0045-0000-0000-0000-000000000045", // Venkat Dakshinamurthy
    taasR8: "user0046-0000-0000-0000-000000000046", // Padma Parthasarathy
    taasR9: "user0047-0000-0000-0000-000000000047", // Murugan Subramanian
    taasR10: "user0048-0000-0000-0000-000000000048", // Usha Venkataraman
    taasR11: "user0049-0000-0000-0000-000000000049", // Gopal Narayanan
    taasR12: "user0050-0000-0000-0000-000000000050", // Sumathi Balakrishnan
  },

  // Teams — KaaS
  team: {
    kaasRoot: "team0001-0000-0000-0000-000000000001",
    kaasSales: "team0002-0000-0000-0000-000000000002",
    kaasDelivery: "team0003-0000-0000-0000-000000000003",
    joesTeam: "team0004-0000-0000-0000-000000000004",
    alphaSquad: "team0005-0000-0000-0000-000000000005",
    betaSquad: "team0006-0000-0000-0000-000000000006",
    // TaaS
    taasRoot: "team0007-0000-0000-0000-000000000007",
    taasSales: "team0008-0000-0000-0000-000000000008",
    taasDelivery: "team0009-0000-0000-0000-000000000009",
    deltaTeam: "team0010-0000-0000-0000-000000000010",
    gammaTeam: "team0011-0000-0000-0000-000000000011",
  },

  // Skills
  skill: {
    java: "skil0001-0000-0000-0000-000000000001",
    springBoot: "skil0002-0000-0000-0000-000000000002",
    microservices: "skil0003-0000-0000-0000-000000000003",
    docker: "skil0004-0000-0000-0000-000000000004",
    kafka: "skil0005-0000-0000-0000-000000000005",
    react: "skil0006-0000-0000-0000-000000000006",
    typescript: "skil0007-0000-0000-0000-000000000007",
    nextjs: "skil0008-0000-0000-0000-000000000008",
    tailwind: "skil0009-0000-0000-0000-000000000009",
    aws: "skil0010-0000-0000-0000-000000000010",
    terraform: "skil0011-0000-0000-0000-000000000011",
    cicd: "skil0012-0000-0000-0000-000000000012",
    kubernetes: "skil0013-0000-0000-0000-000000000013",
    python: "skil0014-0000-0000-0000-000000000014",
    spark: "skil0015-0000-0000-0000-000000000015",
    airflow: "skil0016-0000-0000-0000-000000000016",
    sql: "skil0017-0000-0000-0000-000000000017",
    nodejs: "skil0018-0000-0000-0000-000000000018",
    express: "skil0019-0000-0000-0000-000000000019",
    postgresql: "skil0020-0000-0000-0000-000000000020",
    redis: "skil0021-0000-0000-0000-000000000021",
    azure: "skil0022-0000-0000-0000-000000000022",
    aks: "skil0023-0000-0000-0000-000000000023",
    golang: "skil0024-0000-0000-0000-000000000024",
    grpc: "skil0025-0000-0000-0000-000000000025",
    helm: "skil0026-0000-0000-0000-000000000026",
    tensorflow: "skil0027-0000-0000-0000-000000000027",
    mlflow: "skil0028-0000-0000-0000-000000000028",
    sapHana: "skil0029-0000-0000-0000-000000000029",
    abap: "skil0030-0000-0000-0000-000000000030",
    fico: "skil0031-0000-0000-0000-000000000031",
    springCloud: "skil0032-0000-0000-0000-000000000032",
    angular: "skil0033-0000-0000-0000-000000000033",
    salesforce: "skil0034-0000-0000-0000-000000000034",
    oracleDba: "skil0035-0000-0000-0000-000000000035",
    tableau: "skil0036-0000-0000-0000-000000000036",
  },

  // Clients
  client: {
    infosys: "clnt0001-0000-0000-0000-000000000001",
    wipro: "clnt0002-0000-0000-0000-000000000002",
    hcl: "clnt0003-0000-0000-0000-000000000003",
    mphasis: "clnt0004-0000-0000-0000-000000000004",
    tcs: "clnt0005-0000-0000-0000-000000000005",
    cognizant: "clnt0006-0000-0000-0000-000000000006",
    lti: "clnt0007-0000-0000-0000-000000000007",
    persistent: "clnt0008-0000-0000-0000-000000000008",
  },

  // Requirements
  req: {
    r10001: "req10001-0000-0000-0000-000000000001",
    r10002: "req10002-0000-0000-0000-000000000002",
    r10003: "req10003-0000-0000-0000-000000000003",
    r10004: "req10004-0000-0000-0000-000000000004",
    r10005: "req10005-0000-0000-0000-000000000005",
    r10006: "req10006-0000-0000-0000-000000000006",
    r10007: "req10007-0000-0000-0000-000000000007",
    r10008: "req10008-0000-0000-0000-000000000008",
    r10009: "req10009-0000-0000-0000-000000000009",
    r10010: "req10010-0000-0000-0000-000000000010",
    r10011: "req10011-0000-0000-0000-000000000011",
    r10012: "req10012-0000-0000-0000-000000000012",
    r10013: "req10013-0000-0000-0000-000000000013",
    r20001: "req20001-0000-0000-0000-000000000014",
    r20002: "req20002-0000-0000-0000-000000000015",
    r20003: "req20003-0000-0000-0000-000000000016",
    r20004: "req20004-0000-0000-0000-000000000017",
    r20005: "req20005-0000-0000-0000-000000000018",
    r20006: "req20006-0000-0000-0000-000000000019",
    r20007: "req20007-0000-0000-0000-000000000020",
    r20008: "req20008-0000-0000-0000-000000000021",
    r20009: "req20009-0000-0000-0000-000000000022",
    r20010: "req20010-0000-0000-0000-000000000023",
    r20011: "req20011-0000-0000-0000-000000000024",
    r20012: "req20012-0000-0000-0000-000000000025",
    r20013: "req20013-0000-0000-0000-000000000026",
  },
};

// ─────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────

async function main() {
  console.log("🌱 Seeding TalentOS...\n");

  // ──────────────────────────────────────
  // 1. ROLES & PERMISSIONS
  // ──────────────────────────────────────
  console.log("📋 Roles & permissions...");

  const roleDefs = [
    {
      id: ID.role.superAdmin,
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
      id: ID.role.admin,
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
      id: ID.role.deliveryManager,
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
      id: ID.role.teamLead,
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
      id: ID.role.recruiter,
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
      id: ID.role.sales,
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

  for (const { permissions, ...roleData } of roleDefs) {
    await prisma.role.upsert({
      where: { id: roleData.id },
      update: { name: roleData.name, description: roleData.description },
      create: roleData,
    });
    // wipe and re-create permissions so re-runs are clean
    await prisma.rolePermission.deleteMany({ where: { roleId: roleData.id } });
    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ ...p, roleId: roleData.id })),
    });
  }
  console.log("  ✅ 6 roles with permissions\n");

  // ──────────────────────────────────────
  // 2. BUSINESS UNITS
  // ──────────────────────────────────────
  console.log("🏢 Business Units...");
  await prisma.businessUnit.upsert({
    where: { id: ID.bu.kaas },
    update: {},
    create: { id: ID.bu.kaas, name: "KaaS BU", isActive: true },
  });
  await prisma.businessUnit.upsert({
    where: { id: ID.bu.taas },
    update: {},
    create: { id: ID.bu.taas, name: "TaaS BU", isActive: true },
  });
  console.log("  ✅ KaaS BU, TaaS BU\n");

  // ──────────────────────────────────────
  // 3. USERS
  // ──────────────────────────────────────
  console.log("👤 Users...");

  const userDefs = [
    // ── System ──
    {
      id: ID.user.superAdmin,
      email: "superadmin@talentos.com",
      password: "Admin@123",
      firstName: "Super",
      lastName: "Admin",
      employeeId: "EMP-0001",
      isSuperAdmin: true,
      roleId: ID.role.superAdmin,
      businessUnitId: null,
      reportingToId: null,
      createdById: null,
    },
    // ── KaaS ──
    {
      id: ID.user.kaasAdmin,
      email: "admin.kaas@talentos.com",
      password: "Admin@123",
      firstName: "Priya",
      lastName: "Menon",
      employeeId: "EMP-0002",
      roleId: ID.role.admin,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.superAdmin,
      createdById: ID.user.superAdmin,
    },
    {
      id: ID.user.kaasDM1,
      email: "dm1.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Papitha",
      lastName: "Raj",
      employeeId: "EMP-0003",
      roleId: ID.role.deliveryManager,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasAdmin,
      createdById: ID.user.kaasAdmin,
    },
    {
      id: ID.user.kaasDM2,
      email: "dm2.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Nandini",
      lastName: "Krishnan",
      employeeId: "EMP-0004",
      roleId: ID.role.deliveryManager,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasAdmin,
      createdById: ID.user.kaasAdmin,
    },
    {
      id: ID.user.kaasDM3,
      email: "dm3.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Suresh",
      lastName: "Balakrishnan",
      employeeId: "EMP-0005",
      roleId: ID.role.deliveryManager,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasAdmin,
      createdById: ID.user.kaasAdmin,
    },
    {
      id: ID.user.kaasTL1,
      email: "tl1.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Joe",
      lastName: "Thomas",
      employeeId: "EMP-0006",
      roleId: ID.role.teamLead,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasDM1,
      createdById: ID.user.kaasAdmin,
    },
    {
      id: ID.user.kaasTL2,
      email: "tl2.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Ananya",
      lastName: "Reddy",
      employeeId: "EMP-0007",
      roleId: ID.role.teamLead,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasDM2,
      createdById: ID.user.kaasAdmin,
    },
    {
      id: ID.user.kaasTL3,
      email: "tl3.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Vikram",
      lastName: "Patel",
      employeeId: "EMP-0008",
      roleId: ID.role.teamLead,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasDM2,
      createdById: ID.user.kaasAdmin,
    },
    {
      id: ID.user.kaasTL4,
      email: "tl4.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Divya",
      lastName: "Sharma",
      employeeId: "EMP-0009",
      roleId: ID.role.teamLead,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasDM3,
      createdById: ID.user.kaasAdmin,
    },
    {
      id: ID.user.kaasSales1,
      email: "sales1.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Sneha",
      lastName: "Pillai",
      employeeId: "EMP-0010",
      roleId: ID.role.sales,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasAdmin,
      createdById: ID.user.kaasAdmin,
    },
    {
      id: ID.user.kaasSales2,
      email: "sales2.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Rohan",
      lastName: "Joshi",
      employeeId: "EMP-0011",
      roleId: ID.role.sales,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasAdmin,
      createdById: ID.user.kaasAdmin,
    },
    {
      id: ID.user.kaasSales3,
      email: "sales3.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Kavya",
      lastName: "Rao",
      employeeId: "EMP-0012",
      roleId: ID.role.sales,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasAdmin,
      createdById: ID.user.kaasAdmin,
    },
    {
      id: ID.user.kaasSales4,
      email: "sales4.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Aakash",
      lastName: "Shetty",
      employeeId: "EMP-0013",
      roleId: ID.role.sales,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasAdmin,
      createdById: ID.user.kaasAdmin,
    },
    {
      id: ID.user.kaasSales5,
      email: "sales5.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Meera",
      lastName: "Kamath",
      employeeId: "EMP-0014",
      roleId: ID.role.sales,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasAdmin,
      createdById: ID.user.kaasAdmin,
    },
    // KaaS Recruiters — Joe's Team
    {
      id: ID.user.kaasR1,
      email: "r01.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Ritu",
      lastName: "Verma",
      employeeId: "EMP-0015",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasTL1,
      createdById: ID.user.kaasAdmin,
    },
    {
      id: ID.user.kaasR2,
      email: "r02.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Karan",
      lastName: "Nair",
      employeeId: "EMP-0016",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasTL1,
      createdById: ID.user.kaasAdmin,
    },
    // KaaS Recruiters — Alpha Squad (TL2)
    {
      id: ID.user.kaasR3,
      email: "r03.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Arjun",
      lastName: "Kumar",
      employeeId: "EMP-0017",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasTL2,
      createdById: ID.user.kaasAdmin,
    },
    {
      id: ID.user.kaasR4,
      email: "r04.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Pooja",
      lastName: "Iyer",
      employeeId: "EMP-0018",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasTL2,
      createdById: ID.user.kaasAdmin,
    },
    {
      id: ID.user.kaasR5,
      email: "r05.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Rahul",
      lastName: "Menon",
      employeeId: "EMP-0019",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasTL2,
      createdById: ID.user.kaasAdmin,
    },
    {
      id: ID.user.kaasR6,
      email: "r06.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Swathi",
      lastName: "Nair",
      employeeId: "EMP-0020",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasTL2,
      createdById: ID.user.kaasAdmin,
    },
    {
      id: ID.user.kaasR7,
      email: "r07.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Ajay",
      lastName: "Pillai",
      employeeId: "EMP-0021",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasTL2,
      createdById: ID.user.kaasAdmin,
    },
    // KaaS Recruiters — Beta Squad (TL3)
    {
      id: ID.user.kaasR8,
      email: "r08.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Harish",
      lastName: "Venkat",
      employeeId: "EMP-0022",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasTL3,
      createdById: ID.user.kaasAdmin,
    },
    {
      id: ID.user.kaasR9,
      email: "r09.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Lakshmi",
      lastName: "Ganesan",
      employeeId: "EMP-0023",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasTL3,
      createdById: ID.user.kaasAdmin,
    },
    {
      id: ID.user.kaasR10,
      email: "r10.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Sanjay",
      lastName: "Ramasamy",
      employeeId: "EMP-0024",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasTL3,
      createdById: ID.user.kaasAdmin,
    },
    {
      id: ID.user.kaasR11,
      email: "r11.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Asha",
      lastName: "Natarajan",
      employeeId: "EMP-0025",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasTL3,
      createdById: ID.user.kaasAdmin,
    },
    {
      id: ID.user.kaasR12,
      email: "r12.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Vinod",
      lastName: "Rajan",
      employeeId: "EMP-0026",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasTL3,
      createdById: ID.user.kaasAdmin,
    },
    // KaaS Recruiters — TL4 squad (inside Joe's Team hierarchy)
    {
      id: ID.user.kaasR13,
      email: "r13.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Geetha",
      lastName: "Sundaram",
      employeeId: "EMP-0027",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasTL4,
      createdById: ID.user.kaasAdmin,
    },
    {
      id: ID.user.kaasR14,
      email: "r14.kaas@talentos.com",
      password: "Pass@123",
      firstName: "Nikhil",
      lastName: "Raghunathan",
      employeeId: "EMP-0028",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.kaas,
      reportingToId: ID.user.kaasTL4,
      createdById: ID.user.kaasAdmin,
    },
    // ── TaaS ──
    {
      id: ID.user.taasAdmin,
      email: "admin.taas@talentos.com",
      password: "Admin@123",
      firstName: "Rajesh",
      lastName: "Iyer",
      employeeId: "EMP-0029",
      roleId: ID.role.admin,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.superAdmin,
      createdById: ID.user.superAdmin,
    },
    {
      id: ID.user.taasDM1,
      email: "dm1.taas@talentos.com",
      password: "Pass@123",
      firstName: "Karthik",
      lastName: "Subramaniam",
      employeeId: "EMP-0030",
      roleId: ID.role.deliveryManager,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.taasAdmin,
      createdById: ID.user.taasAdmin,
    },
    {
      id: ID.user.taasDM2,
      email: "dm2.taas@talentos.com",
      password: "Pass@123",
      firstName: "Revathi",
      lastName: "Parthasarathy",
      employeeId: "EMP-0031",
      roleId: ID.role.deliveryManager,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.taasAdmin,
      createdById: ID.user.taasAdmin,
    },
    {
      id: ID.user.taasTL1,
      email: "tl1.taas@talentos.com",
      password: "Pass@123",
      firstName: "Varun",
      lastName: "Dakshinamurthy",
      employeeId: "EMP-0032",
      roleId: ID.role.teamLead,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.taasDM1,
      createdById: ID.user.taasAdmin,
    },
    {
      id: ID.user.taasTL2,
      email: "tl2.taas@talentos.com",
      password: "Pass@123",
      firstName: "Naveen",
      lastName: "Subramanian",
      employeeId: "EMP-0033",
      roleId: ID.role.teamLead,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.taasDM1,
      createdById: ID.user.taasAdmin,
    },
    {
      id: ID.user.taasTL3,
      email: "tl3.taas@talentos.com",
      password: "Pass@123",
      firstName: "Yamini",
      lastName: "Murugesan",
      employeeId: "EMP-0034",
      roleId: ID.role.teamLead,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.taasDM2,
      createdById: ID.user.taasAdmin,
    },
    {
      id: ID.user.taasSales1,
      email: "sales1.taas@talentos.com",
      password: "Pass@123",
      firstName: "Balaji",
      lastName: "Narayanan",
      employeeId: "EMP-0035",
      roleId: ID.role.sales,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.taasAdmin,
      createdById: ID.user.taasAdmin,
    },
    {
      id: ID.user.taasSales2,
      email: "sales2.taas@talentos.com",
      password: "Pass@123",
      firstName: "Chithra",
      lastName: "Krishnan",
      employeeId: "EMP-0036",
      roleId: ID.role.sales,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.taasAdmin,
      createdById: ID.user.taasAdmin,
    },
    {
      id: ID.user.taasSales3,
      email: "sales3.taas@talentos.com",
      password: "Pass@123",
      firstName: "Dinesh",
      lastName: "Venkataraman",
      employeeId: "EMP-0037",
      roleId: ID.role.sales,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.taasAdmin,
      createdById: ID.user.taasAdmin,
    },
    {
      id: ID.user.taasSales4,
      email: "sales4.taas@talentos.com",
      password: "Pass@123",
      firstName: "Hema",
      lastName: "Balakrishnan",
      employeeId: "EMP-0038",
      roleId: ID.role.sales,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.taasAdmin,
      createdById: ID.user.taasAdmin,
    },
    // TaaS Recruiters — Delta (TL1)
    {
      id: ID.user.taasR1,
      email: "r01.taas@talentos.com",
      password: "Pass@123",
      firstName: "Mohan",
      lastName: "Ramasamy",
      employeeId: "EMP-0039",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.taasTL1,
      createdById: ID.user.taasAdmin,
    },
    {
      id: ID.user.taasR2,
      email: "r02.taas@talentos.com",
      password: "Pass@123",
      firstName: "Pavithra",
      lastName: "Rajan",
      employeeId: "EMP-0040",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.taasTL1,
      createdById: ID.user.taasAdmin,
    },
    {
      id: ID.user.taasR3,
      email: "r03.taas@talentos.com",
      password: "Pass@123",
      firstName: "Ganesh",
      lastName: "Sundaram",
      employeeId: "EMP-0041",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.taasTL1,
      createdById: ID.user.taasAdmin,
    },
    {
      id: ID.user.taasR4,
      email: "r04.taas@talentos.com",
      password: "Pass@123",
      firstName: "Janani",
      lastName: "Natarajan",
      employeeId: "EMP-0042",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.taasTL1,
      createdById: ID.user.taasAdmin,
    },
    {
      id: ID.user.taasR5,
      email: "r05.taas@talentos.com",
      password: "Pass@123",
      firstName: "Ramesh",
      lastName: "Annamalai",
      employeeId: "EMP-0043",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.taasTL1,
      createdById: ID.user.taasAdmin,
    },
    // TaaS Recruiters — Gamma (TL2)
    {
      id: ID.user.taasR6,
      email: "r06.taas@talentos.com",
      password: "Pass@123",
      firstName: "Vijaya",
      lastName: "Chandrasekaran",
      employeeId: "EMP-0044",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.taasTL2,
      createdById: ID.user.taasAdmin,
    },
    {
      id: ID.user.taasR7,
      email: "r07.taas@talentos.com",
      password: "Pass@123",
      firstName: "Venkat",
      lastName: "Dakshinamurthy",
      employeeId: "EMP-0045",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.taasTL2,
      createdById: ID.user.taasAdmin,
    },
    {
      id: ID.user.taasR8,
      email: "r08.taas@talentos.com",
      password: "Pass@123",
      firstName: "Padma",
      lastName: "Parthasarathy",
      employeeId: "EMP-0046",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.taasTL2,
      createdById: ID.user.taasAdmin,
    },
    {
      id: ID.user.taasR9,
      email: "r09.taas@talentos.com",
      password: "Pass@123",
      firstName: "Murugan",
      lastName: "Subramanian",
      employeeId: "EMP-0047",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.taasTL2,
      createdById: ID.user.taasAdmin,
    },
    {
      id: ID.user.taasR10,
      email: "r10.taas@talentos.com",
      password: "Pass@123",
      firstName: "Usha",
      lastName: "Venkataraman",
      employeeId: "EMP-0048",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.taasTL2,
      createdById: ID.user.taasAdmin,
    },
    // TaaS Recruiters — TL3
    {
      id: ID.user.taasR11,
      email: "r11.taas@talentos.com",
      password: "Pass@123",
      firstName: "Gopal",
      lastName: "Narayanan",
      employeeId: "EMP-0049",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.taasTL3,
      createdById: ID.user.taasAdmin,
    },
    {
      id: ID.user.taasR12,
      email: "r12.taas@talentos.com",
      password: "Pass@123",
      firstName: "Sumathi",
      lastName: "Balakrishnan",
      employeeId: "EMP-0050",
      roleId: ID.role.recruiter,
      businessUnitId: ID.bu.taas,
      reportingToId: ID.user.taasTL3,
      createdById: ID.user.taasAdmin,
    },
  ];

  for (const u of userDefs) {
    const { password, ...rest } = u;
    await prisma.user.upsert({
      where: { id: u.id },
      update: { roleId: u.roleId },
      create: { ...rest, passwordHash: hash(password) },
    });
  }
  console.log(`  ✅ ${userDefs.length} users\n`);

  // ──────────────────────────────────────
  // 4. TEAMS
  // ──────────────────────────────────────
  console.log("👥 Teams...");

  const teamDefs = [
    // KaaS
    {
      id: ID.team.kaasRoot,
      name: "KaaS Ecosystem",
      description: "Root for KaaS BU",
      nodeType: "MANAGEMENT",
      category: "MANAGEMENT",
      buId: ID.bu.kaas,
      parentTeamId: null,
    },
    {
      id: ID.team.kaasSales,
      name: "KaaS Sales Team",
      description: "KaaS sales function",
      nodeType: "GROUP",
      category: "SALES",
      buId: ID.bu.kaas,
      parentTeamId: ID.team.kaasRoot,
    },
    {
      id: ID.team.kaasDelivery,
      name: "KaaS Delivery Team",
      description: "KaaS delivery function",
      nodeType: "GROUP",
      category: "DELIVERY",
      buId: ID.bu.kaas,
      parentTeamId: ID.team.kaasRoot,
    },
    {
      id: ID.team.joesTeam,
      name: "Joe's Team",
      description: "Joe's recruiting squad",
      nodeType: "GROUP",
      category: "DELIVERY",
      buId: ID.bu.kaas,
      parentTeamId: ID.team.kaasDelivery,
    },
    {
      id: ID.team.alphaSquad,
      name: "Alpha Squad",
      description: "Senior tech stack recruiters",
      nodeType: "GROUP",
      category: "DELIVERY",
      buId: ID.bu.kaas,
      parentTeamId: ID.team.kaasDelivery,
    },
    {
      id: ID.team.betaSquad,
      name: "Beta Squad",
      description: "Mid-level & contract roles",
      nodeType: "GROUP",
      category: "DELIVERY",
      buId: ID.bu.kaas,
      parentTeamId: ID.team.kaasDelivery,
    },
    // TaaS
    {
      id: ID.team.taasRoot,
      name: "TaaS Ecosystem",
      description: "Root for TaaS BU",
      nodeType: "MANAGEMENT",
      category: "MANAGEMENT",
      buId: ID.bu.taas,
      parentTeamId: null,
    },
    {
      id: ID.team.taasSales,
      name: "TaaS Sales Team",
      description: "TaaS sales function",
      nodeType: "GROUP",
      category: "SALES",
      buId: ID.bu.taas,
      parentTeamId: ID.team.taasRoot,
    },
    {
      id: ID.team.taasDelivery,
      name: "TaaS Delivery Team",
      description: "TaaS delivery function",
      nodeType: "GROUP",
      category: "DELIVERY",
      buId: ID.bu.taas,
      parentTeamId: ID.team.taasRoot,
    },
    {
      id: ID.team.deltaTeam,
      name: "Delta Team",
      description: "BFSI & consulting vertical",
      nodeType: "GROUP",
      category: "DELIVERY",
      buId: ID.bu.taas,
      parentTeamId: ID.team.taasDelivery,
    },
    {
      id: ID.team.gammaTeam,
      name: "Gamma Team",
      description: "SAP & ERP specialists",
      nodeType: "GROUP",
      category: "DELIVERY",
      buId: ID.bu.taas,
      parentTeamId: ID.team.taasDelivery,
    },
  ];

  for (const t of teamDefs) {
    await prisma.team.upsert({
      where: { id: t.id },
      update: { name: t.name },
      create: {
        id: t.id,
        name: t.name,
        description: t.description,
        nodeType: t.nodeType,
        category: t.category,
        isActive: true,
        businessUnitId: t.buId,
        parentTeamId: t.parentTeamId,
      },
    });
  }
  console.log("  ✅ 11 teams\n");

  // ──────────────────────────────────────
  // 5. TEAM EDGES
  // Every parent→child pair gets exactly 3 rows:
  // ASSIGNS_TO, REPORTS_TO, VISIBILITY
  // ──────────────────────────────────────
  console.log("🔗 Team edges (3 per pair)...");

  const teamPairs = [
    // KaaS
    [ID.team.kaasRoot, ID.team.kaasSales],
    [ID.team.kaasRoot, ID.team.kaasDelivery],
    [ID.team.kaasDelivery, ID.team.joesTeam],
    [ID.team.kaasDelivery, ID.team.alphaSquad],
    [ID.team.kaasDelivery, ID.team.betaSquad],
    // TaaS
    [ID.team.taasRoot, ID.team.taasSales],
    [ID.team.taasRoot, ID.team.taasDelivery],
    [ID.team.taasDelivery, ID.team.deltaTeam],
    [ID.team.taasDelivery, ID.team.gammaTeam],
  ];

  for (const [parentId, childId] of teamPairs) {
    for (const edgeType of ["ASSIGNS_TO", "REPORTS_TO", "VISIBILITY"]) {
      await prisma.teamEdge.upsert({
        where: { parentId_childId_edgeType: { parentId, childId, edgeType } },
        update: {},
        create: { parentId, childId, edgeType, isActive: true },
      });
    }
  }
  console.log(
    `  ✅ ${teamPairs.length * 3} edges (${teamPairs.length} pairs × 3)\n`
  );

  // ──────────────────────────────────────
  // 6. TEAM MEMBERS
  // ──────────────────────────────────────
  console.log("🧑‍🤝‍🧑 Team members...");

  const memberDefs = [
    // KaaS Sales Team
    { userId: ID.user.kaasSales1, teamId: ID.team.kaasSales, teamRole: "LEAD" },
    {
      userId: ID.user.kaasSales2,
      teamId: ID.team.kaasSales,
      teamRole: "MEMBER",
    },
    {
      userId: ID.user.kaasSales3,
      teamId: ID.team.kaasSales,
      teamRole: "MEMBER",
    },
    {
      userId: ID.user.kaasSales4,
      teamId: ID.team.kaasSales,
      teamRole: "MEMBER",
    },
    {
      userId: ID.user.kaasSales5,
      teamId: ID.team.kaasSales,
      teamRole: "MEMBER",
    },
    // KaaS Delivery Team (DM level)
    { userId: ID.user.kaasDM1, teamId: ID.team.kaasDelivery, teamRole: "LEAD" },
    {
      userId: ID.user.kaasDM2,
      teamId: ID.team.kaasDelivery,
      teamRole: "CO_LEAD",
    },
    {
      userId: ID.user.kaasDM3,
      teamId: ID.team.kaasDelivery,
      teamRole: "MEMBER",
    },
    // Joe's Team
    { userId: ID.user.kaasTL1, teamId: ID.team.joesTeam, teamRole: "LEAD" },
    { userId: ID.user.kaasTL4, teamId: ID.team.joesTeam, teamRole: "CO_LEAD" },
    { userId: ID.user.kaasR1, teamId: ID.team.joesTeam, teamRole: "MEMBER" },
    { userId: ID.user.kaasR2, teamId: ID.team.joesTeam, teamRole: "MEMBER" },
    { userId: ID.user.kaasR13, teamId: ID.team.joesTeam, teamRole: "MEMBER" },
    { userId: ID.user.kaasR14, teamId: ID.team.joesTeam, teamRole: "MEMBER" },
    // Alpha Squad
    { userId: ID.user.kaasTL2, teamId: ID.team.alphaSquad, teamRole: "LEAD" },
    { userId: ID.user.kaasR3, teamId: ID.team.alphaSquad, teamRole: "MEMBER" },
    { userId: ID.user.kaasR4, teamId: ID.team.alphaSquad, teamRole: "MEMBER" },
    { userId: ID.user.kaasR5, teamId: ID.team.alphaSquad, teamRole: "MEMBER" },
    { userId: ID.user.kaasR6, teamId: ID.team.alphaSquad, teamRole: "MEMBER" },
    { userId: ID.user.kaasR7, teamId: ID.team.alphaSquad, teamRole: "MEMBER" },
    // Beta Squad
    { userId: ID.user.kaasTL3, teamId: ID.team.betaSquad, teamRole: "LEAD" },
    { userId: ID.user.kaasR8, teamId: ID.team.betaSquad, teamRole: "MEMBER" },
    { userId: ID.user.kaasR9, teamId: ID.team.betaSquad, teamRole: "MEMBER" },
    { userId: ID.user.kaasR10, teamId: ID.team.betaSquad, teamRole: "MEMBER" },
    { userId: ID.user.kaasR11, teamId: ID.team.betaSquad, teamRole: "MEMBER" },
    { userId: ID.user.kaasR12, teamId: ID.team.betaSquad, teamRole: "MEMBER" },
    // TaaS Sales Team
    { userId: ID.user.taasSales1, teamId: ID.team.taasSales, teamRole: "LEAD" },
    {
      userId: ID.user.taasSales2,
      teamId: ID.team.taasSales,
      teamRole: "MEMBER",
    },
    {
      userId: ID.user.taasSales3,
      teamId: ID.team.taasSales,
      teamRole: "MEMBER",
    },
    {
      userId: ID.user.taasSales4,
      teamId: ID.team.taasSales,
      teamRole: "MEMBER",
    },
    // TaaS Delivery Team
    { userId: ID.user.taasDM1, teamId: ID.team.taasDelivery, teamRole: "LEAD" },
    {
      userId: ID.user.taasDM2,
      teamId: ID.team.taasDelivery,
      teamRole: "CO_LEAD",
    },
    // Delta Team
    { userId: ID.user.taasTL1, teamId: ID.team.deltaTeam, teamRole: "LEAD" },
    { userId: ID.user.taasR1, teamId: ID.team.deltaTeam, teamRole: "MEMBER" },
    { userId: ID.user.taasR2, teamId: ID.team.deltaTeam, teamRole: "MEMBER" },
    { userId: ID.user.taasR3, teamId: ID.team.deltaTeam, teamRole: "MEMBER" },
    { userId: ID.user.taasR4, teamId: ID.team.deltaTeam, teamRole: "MEMBER" },
    { userId: ID.user.taasR5, teamId: ID.team.deltaTeam, teamRole: "MEMBER" },
    // Gamma Team
    { userId: ID.user.taasTL2, teamId: ID.team.gammaTeam, teamRole: "LEAD" },
    { userId: ID.user.taasTL3, teamId: ID.team.gammaTeam, teamRole: "CO_LEAD" },
    { userId: ID.user.taasR6, teamId: ID.team.gammaTeam, teamRole: "MEMBER" },
    { userId: ID.user.taasR7, teamId: ID.team.gammaTeam, teamRole: "MEMBER" },
    { userId: ID.user.taasR8, teamId: ID.team.gammaTeam, teamRole: "MEMBER" },
    { userId: ID.user.taasR9, teamId: ID.team.gammaTeam, teamRole: "MEMBER" },
    { userId: ID.user.taasR10, teamId: ID.team.gammaTeam, teamRole: "MEMBER" },
    { userId: ID.user.taasR11, teamId: ID.team.gammaTeam, teamRole: "MEMBER" },
    { userId: ID.user.taasR12, teamId: ID.team.gammaTeam, teamRole: "MEMBER" },
  ];

  for (const m of memberDefs) {
    await prisma.teamMember.upsert({
      where: { userId_teamId: { userId: m.userId, teamId: m.teamId } },
      update: { teamRole: m.teamRole },
      create: { ...m, isActive: true },
    });
  }
  console.log(`  ✅ ${memberDefs.length} team memberships\n`);

  // ──────────────────────────────────────
  // 7. SKILLS — canonical registry
  // ──────────────────────────────────────
  console.log("🛠 Skills...");

  const skillDefs = [
    {
      id: ID.skill.java,
      canonicalName: "Java",
      aliases: ["java", "Java SE", "Java EE"],
    },
    {
      id: ID.skill.springBoot,
      canonicalName: "Spring Boot",
      aliases: ["springboot", "spring-boot"],
    },
    {
      id: ID.skill.microservices,
      canonicalName: "Microservices",
      aliases: ["micro services", "microservice architecture"],
    },
    {
      id: ID.skill.docker,
      canonicalName: "Docker",
      aliases: ["docker container", "containerization"],
    },
    {
      id: ID.skill.kafka,
      canonicalName: "Kafka",
      aliases: ["Apache Kafka", "kafka streams"],
    },
    {
      id: ID.skill.react,
      canonicalName: "React",
      aliases: ["ReactJS", "React.js", "react js"],
    },
    {
      id: ID.skill.typescript,
      canonicalName: "TypeScript",
      aliases: ["TS", "typescript"],
    },
    {
      id: ID.skill.nextjs,
      canonicalName: "Next.js",
      aliases: ["NextJS", "next js"],
    },
    {
      id: ID.skill.tailwind,
      canonicalName: "Tailwind CSS",
      aliases: ["tailwind", "tailwindcss"],
    },
    {
      id: ID.skill.aws,
      canonicalName: "AWS",
      aliases: ["Amazon Web Services", "amazon aws"],
    },
    {
      id: ID.skill.terraform,
      canonicalName: "Terraform",
      aliases: ["terraform iac", "hashicorp terraform"],
    },
    {
      id: ID.skill.cicd,
      canonicalName: "CI/CD",
      aliases: ["cicd", "continuous integration", "continuous delivery"],
    },
    {
      id: ID.skill.kubernetes,
      canonicalName: "Kubernetes",
      aliases: ["K8s", "k8s", "kube"],
    },
    {
      id: ID.skill.python,
      canonicalName: "Python",
      aliases: ["python3", "python 3"],
    },
    {
      id: ID.skill.spark,
      canonicalName: "Apache Spark",
      aliases: ["spark", "pyspark"],
    },
    {
      id: ID.skill.airflow,
      canonicalName: "Apache Airflow",
      aliases: ["airflow"],
    },
    {
      id: ID.skill.sql,
      canonicalName: "SQL",
      aliases: ["structured query language", "rdbms"],
    },
    {
      id: ID.skill.nodejs,
      canonicalName: "Node.js",
      aliases: ["NodeJS", "node js", "nodejs"],
    },
    {
      id: ID.skill.express,
      canonicalName: "Express.js",
      aliases: ["expressjs", "express"],
    },
    {
      id: ID.skill.postgresql,
      canonicalName: "PostgreSQL",
      aliases: ["postgres", "pg"],
    },
    {
      id: ID.skill.redis,
      canonicalName: "Redis",
      aliases: ["redis cache", "redis db"],
    },
    {
      id: ID.skill.azure,
      canonicalName: "Azure",
      aliases: ["Microsoft Azure", "ms azure"],
    },
    {
      id: ID.skill.aks,
      canonicalName: "AKS",
      aliases: ["Azure Kubernetes Service"],
    },
    {
      id: ID.skill.golang,
      canonicalName: "Golang",
      aliases: ["Go", "go lang"],
    },
    {
      id: ID.skill.grpc,
      canonicalName: "gRPC",
      aliases: ["grpc", "google rpc"],
    },
    { id: ID.skill.helm, canonicalName: "Helm", aliases: ["helm charts"] },
    {
      id: ID.skill.tensorflow,
      canonicalName: "TensorFlow",
      aliases: ["tensorflow", "tf"],
    },
    { id: ID.skill.mlflow, canonicalName: "MLflow", aliases: ["mlflow"] },
    {
      id: ID.skill.sapHana,
      canonicalName: "SAP S/4 HANA",
      aliases: ["s4hana", "sap hana", "SAP HANA"],
    },
    { id: ID.skill.abap, canonicalName: "ABAP", aliases: ["sap abap"] },
    {
      id: ID.skill.fico,
      canonicalName: "SAP FICO",
      aliases: ["fico", "sap fi", "sap co"],
    },
    {
      id: ID.skill.springCloud,
      canonicalName: "Spring Cloud",
      aliases: ["spring-cloud"],
    },
    {
      id: ID.skill.angular,
      canonicalName: "Angular",
      aliases: ["AngularJS", "angular js", "angular 16"],
    },
    {
      id: ID.skill.salesforce,
      canonicalName: "Salesforce",
      aliases: ["salesforce crm", "sfdc"],
    },
    {
      id: ID.skill.oracleDba,
      canonicalName: "Oracle DBA",
      aliases: ["oracle database", "oracle db"],
    },
    {
      id: ID.skill.tableau,
      canonicalName: "Tableau",
      aliases: ["tableau bi", "tableau desktop"],
    },
  ];

  for (const s of skillDefs) {
    await prisma.skill.upsert({
      where: { id: s.id },
      update: { aliases: s.aliases },
      create: s,
    });
  }
  console.log(`  ✅ ${skillDefs.length} skills\n`);

  // ──────────────────────────────────────
  // 8. CLIENTS
  // ──────────────────────────────────────
  console.log("🏭 Clients...");

  const clientDefs = [
    {
      id: ID.client.infosys,
      name: "Infosys BPM",
      vmsName: "Infosys BPM Ltd",
      category: "SERVICE",
      industry: "IT Services",
      state: "Karnataka",
      city: "Bangalore",
      status: "ACTIVE",
      buId: ID.bu.kaas,
      createdById: ID.user.kaasSales1,
      approvedById: ID.user.kaasAdmin,
      daysApproved: 40,
    },
    {
      id: ID.client.wipro,
      name: "Wipro Technologies",
      vmsName: "Wipro Ltd",
      category: "SERVICE",
      industry: "IT Services",
      state: "Karnataka",
      city: "Bangalore",
      status: "ACTIVE",
      buId: ID.bu.kaas,
      createdById: ID.user.kaasSales2,
      approvedById: ID.user.kaasAdmin,
      daysApproved: 50,
    },
    {
      id: ID.client.hcl,
      name: "HCL Tech",
      vmsName: "HCL Technologies",
      category: "SERVICE",
      industry: "IT Services",
      state: "Tamil Nadu",
      city: "Chennai",
      status: "ACTIVE",
      buId: ID.bu.kaas,
      createdById: ID.user.kaasSales3,
      approvedById: ID.user.kaasAdmin,
      daysApproved: 35,
    },
    {
      id: ID.client.mphasis,
      name: "Mphasis Limited",
      vmsName: "Mphasis",
      category: "CONSULTING",
      industry: "BFSI Tech",
      state: "Karnataka",
      city: "Bangalore",
      status: "PENDING",
      buId: ID.bu.kaas,
      createdById: ID.user.kaasSales4,
      approvedById: null,
      daysApproved: null,
    },
    {
      id: ID.client.tcs,
      name: "TCS Digital",
      vmsName: "Tata Consultancy Services",
      category: "SERVICE",
      industry: "IT Consulting",
      state: "Maharashtra",
      city: "Mumbai",
      status: "ACTIVE",
      buId: ID.bu.taas,
      createdById: ID.user.taasSales1,
      approvedById: ID.user.taasAdmin,
      daysApproved: 45,
    },
    {
      id: ID.client.cognizant,
      name: "Cognizant India",
      vmsName: "Cognizant Technology Solutions",
      category: "SERVICE",
      industry: "IT Services",
      state: "Tamil Nadu",
      city: "Chennai",
      status: "ACTIVE",
      buId: ID.bu.taas,
      createdById: ID.user.taasSales2,
      approvedById: ID.user.taasAdmin,
      daysApproved: 38,
    },
    {
      id: ID.client.lti,
      name: "LTIMindtree",
      vmsName: "LTIMindtree Ltd",
      category: "CONSULTING",
      industry: "Digital Transformation",
      state: "Maharashtra",
      city: "Pune",
      status: "ACTIVE",
      buId: ID.bu.taas,
      createdById: ID.user.taasSales3,
      approvedById: ID.user.taasAdmin,
      daysApproved: 30,
    },
    {
      id: ID.client.persistent,
      name: "Persistent Systems",
      vmsName: "Persistent Systems Ltd",
      category: "PRODUCT",
      industry: "SaaS",
      state: "Maharashtra",
      city: "Pune",
      status: "INACTIVE",
      buId: ID.bu.taas,
      createdById: ID.user.taasSales4,
      approvedById: ID.user.taasAdmin,
      daysApproved: 90,
    },
  ];

  for (const c of clientDefs) {
    await prisma.client.upsert({
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
        createdById: c.createdById,
        ...(c.approvedById
          ? {
              approvedById: c.approvedById,
              approvedAt: daysAgo(c.daysApproved),
            }
          : {}),
      },
    });
  }
  console.log("  ✅ 8 clients\n");

  // ──────────────────────────────────────
  // 8a. CLIENT HANDLERS
  // No unique constraint → findFirst + create
  // ──────────────────────────────────────
  console.log("👤 Client handlers...");

  const handlerDefs = [
    {
      clientId: ID.client.infosys,
      userId: ID.user.kaasSales1,
      assignedById: ID.user.kaasAdmin,
    },
    {
      clientId: ID.client.wipro,
      userId: ID.user.kaasSales2,
      assignedById: ID.user.kaasAdmin,
    },
    {
      clientId: ID.client.hcl,
      userId: ID.user.kaasSales3,
      assignedById: ID.user.kaasAdmin,
    },
    {
      clientId: ID.client.mphasis,
      userId: ID.user.kaasSales4,
      assignedById: ID.user.kaasAdmin,
    },
    {
      clientId: ID.client.tcs,
      userId: ID.user.taasSales1,
      assignedById: ID.user.taasAdmin,
    },
    {
      clientId: ID.client.cognizant,
      userId: ID.user.taasSales2,
      assignedById: ID.user.taasAdmin,
    },
    {
      clientId: ID.client.lti,
      userId: ID.user.taasSales3,
      assignedById: ID.user.taasAdmin,
    },
    {
      clientId: ID.client.persistent,
      userId: ID.user.taasSales4,
      assignedById: ID.user.taasAdmin,
    },
  ];

  for (const h of handlerDefs) {
    const existing = await prisma.clientHandler.findFirst({
      where: { clientId: h.clientId, userId: h.userId, status: "ACTIVE" },
    });
    if (!existing) {
      await prisma.clientHandler.create({
        data: { ...h, role: "PRIMARY", status: "ACTIVE" },
      });
    }
  }
  console.log("  ✅ 8 client handlers\n");

  // ──────────────────────────────────────
  // 8b. CLIENT TEAM ASSIGNMENTS
  // ──────────────────────────────────────
  console.log("🔗 Client team assignments...");

  const ctaDefs = [
    {
      clientId: ID.client.infosys,
      teamId: ID.team.kaasDelivery,
      assignedById: ID.user.kaasAdmin,
    },
    {
      clientId: ID.client.wipro,
      teamId: ID.team.alphaSquad,
      assignedById: ID.user.kaasAdmin,
    },
    {
      clientId: ID.client.hcl,
      teamId: ID.team.betaSquad,
      assignedById: ID.user.kaasAdmin,
    },
    {
      clientId: ID.client.tcs,
      teamId: ID.team.taasDelivery,
      assignedById: ID.user.taasAdmin,
    },
    {
      clientId: ID.client.cognizant,
      teamId: ID.team.deltaTeam,
      assignedById: ID.user.taasAdmin,
    },
    {
      clientId: ID.client.lti,
      teamId: ID.team.gammaTeam,
      assignedById: ID.user.taasAdmin,
    },
  ];

  for (const c of ctaDefs) {
    await prisma.clientTeamAssignment.upsert({
      where: { clientId_teamId: { clientId: c.clientId, teamId: c.teamId } },
      update: {},
      create: c,
    });
  }
  console.log("  ✅ 6 client team assignments\n");

  // ──────────────────────────────────────
  // 9. REQUIREMENTS — 25 total
  // ──────────────────────────────────────
  console.log("📝 Requirements (25)...");

  // status: DRAFT | PENDING_APPROVAL | ACTIVE | ON_HOLD | CLOSED | CANCELLED
  const reqDefs = [
    // ── KaaS / Infosys ──
    {
      id: ID.req.r10001,
      code: "SFJ-R-10001",
      title: "Senior Java Developer",
      clientId: ID.client.infosys,
      buId: ID.bu.kaas,
      jobType: "CONTRACT",
      remoteType: "HYBRID",
      priority: "HIGH",
      openings: 3,
      salMin: 800000,
      salMax: 1400000,
      status: "ACTIVE",
      createdById: ID.user.kaasSales1,
      approvedById: ID.user.kaasAdmin,
      closedById: null,
      daysAgo: 45,
    },
    {
      id: ID.req.r10002,
      code: "SFJ-R-10002",
      title: "React Frontend Engineer",
      clientId: ID.client.infosys,
      buId: ID.bu.kaas,
      jobType: "PERMANENT",
      remoteType: "REMOTE",
      priority: "MEDIUM",
      openings: 2,
      salMin: 900000,
      salMax: 1600000,
      status: "ACTIVE",
      createdById: ID.user.kaasSales1,
      approvedById: ID.user.kaasAdmin,
      closedById: null,
      daysAgo: 38,
    },
    {
      id: ID.req.r10003,
      code: "SFJ-R-10003",
      title: "DevOps Engineer (AWS)",
      clientId: ID.client.infosys,
      buId: ID.bu.kaas,
      jobType: "CONTRACT",
      remoteType: "ONSITE",
      priority: "HIGH",
      openings: 1,
      salMin: 1000000,
      salMax: 1800000,
      status: "ACTIVE",
      createdById: ID.user.kaasSales1,
      approvedById: ID.user.kaasAdmin,
      closedById: null,
      daysAgo: 30,
    },
    // ── KaaS / Wipro ──
    {
      id: ID.req.r10004,
      code: "SFJ-R-10004",
      title: "Python Data Engineer",
      clientId: ID.client.wipro,
      buId: ID.bu.kaas,
      jobType: "CONTRACT",
      remoteType: "HYBRID",
      priority: "HIGH",
      openings: 4,
      salMin: 700000,
      salMax: 1300000,
      status: "ACTIVE",
      createdById: ID.user.kaasSales2,
      approvedById: ID.user.kaasAdmin,
      closedById: null,
      daysAgo: 28,
    },
    {
      id: ID.req.r10005,
      code: "SFJ-R-10005",
      title: "Scrum Master",
      clientId: ID.client.wipro,
      buId: ID.bu.kaas,
      jobType: "CONTRACT_TO_HIRE",
      remoteType: "HYBRID",
      priority: "LOW",
      openings: 1,
      salMin: 600000,
      salMax: 900000,
      status: "PENDING_APPROVAL",
      createdById: ID.user.kaasSales2,
      approvedById: null,
      closedById: null,
      daysAgo: 10,
    },
    {
      id: ID.req.r10006,
      code: "SFJ-R-10006",
      title: "SAP FICO Consultant",
      clientId: ID.client.wipro,
      buId: ID.bu.kaas,
      jobType: "PERMANENT",
      remoteType: "ONSITE",
      priority: "MEDIUM",
      openings: 2,
      salMin: 1200000,
      salMax: 2000000,
      status: "ACTIVE",
      createdById: ID.user.kaasSales2,
      approvedById: ID.user.kaasAdmin,
      closedById: null,
      daysAgo: 55,
    },
    {
      id: ID.req.r10007,
      code: "SFJ-R-10007",
      title: "QA Automation Engineer",
      clientId: ID.client.wipro,
      buId: ID.bu.kaas,
      jobType: "CONTRACT",
      remoteType: "REMOTE",
      priority: "MEDIUM",
      openings: 3,
      salMin: 500000,
      salMax: 900000,
      status: "ON_HOLD",
      createdById: ID.user.kaasSales3,
      approvedById: ID.user.kaasAdmin,
      closedById: null,
      daysAgo: 60,
    },
    // ── KaaS / HCL ──
    {
      id: ID.req.r10008,
      code: "SFJ-R-10008",
      title: "Node.js Backend Developer",
      clientId: ID.client.hcl,
      buId: ID.bu.kaas,
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      priority: "HIGH",
      openings: 5,
      salMin: 800000,
      salMax: 1500000,
      status: "ACTIVE",
      createdById: ID.user.kaasSales3,
      approvedById: ID.user.kaasAdmin,
      closedById: null,
      daysAgo: 20,
    },
    {
      id: ID.req.r10009,
      code: "SFJ-R-10009",
      title: "Cloud Architect (Azure)",
      clientId: ID.client.hcl,
      buId: ID.bu.kaas,
      jobType: "CONTRACT",
      remoteType: "ONSITE",
      priority: "HIGH",
      openings: 1,
      salMin: 2000000,
      salMax: 3500000,
      status: "ACTIVE",
      createdById: ID.user.kaasSales3,
      approvedById: ID.user.kaasAdmin,
      closedById: null,
      daysAgo: 15,
    },
    {
      id: ID.req.r10010,
      code: "SFJ-R-10010",
      title: "Business Analyst",
      clientId: ID.client.hcl,
      buId: ID.bu.kaas,
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      priority: "LOW",
      openings: 2,
      salMin: 600000,
      salMax: 1000000,
      status: "CLOSED",
      createdById: ID.user.kaasSales3,
      approvedById: ID.user.kaasAdmin,
      closedById: ID.user.kaasAdmin,
      daysAgo: 90,
    },
    // ── KaaS / Mphasis ──
    {
      id: ID.req.r10011,
      code: "SFJ-R-10011",
      title: "Full Stack Developer (MERN)",
      clientId: ID.client.mphasis,
      buId: ID.bu.kaas,
      jobType: "CONTRACT_TO_HIRE",
      remoteType: "HYBRID",
      priority: "MEDIUM",
      openings: 3,
      salMin: 900000,
      salMax: 1600000,
      status: "DRAFT",
      createdById: ID.user.kaasSales4,
      approvedById: null,
      closedById: null,
      daysAgo: 5,
    },
    {
      id: ID.req.r10012,
      code: "SFJ-R-10012",
      title: "Security Engineer",
      clientId: ID.client.mphasis,
      buId: ID.bu.kaas,
      jobType: "PERMANENT",
      remoteType: "ONSITE",
      priority: "HIGH",
      openings: 1,
      salMin: 1500000,
      salMax: 2500000,
      status: "CANCELLED",
      createdById: ID.user.kaasSales4,
      approvedById: ID.user.kaasAdmin,
      closedById: ID.user.kaasAdmin,
      daysAgo: 80,
    },
    {
      id: ID.req.r10013,
      code: "SFJ-R-10013",
      title: "Technical Writer",
      clientId: ID.client.hcl,
      buId: ID.bu.kaas,
      jobType: "FREELANCE",
      remoteType: "REMOTE",
      priority: "LOW",
      openings: 1,
      salMin: 300000,
      salMax: 600000,
      status: "ACTIVE",
      createdById: ID.user.kaasSales1,
      approvedById: ID.user.kaasAdmin,
      closedById: null,
      daysAgo: 8,
    },
    // ── TaaS / TCS ──
    {
      id: ID.req.r20001,
      code: "SFJ-R-20001",
      title: "Golang Backend Engineer",
      clientId: ID.client.tcs,
      buId: ID.bu.taas,
      jobType: "CONTRACT",
      remoteType: "REMOTE",
      priority: "HIGH",
      openings: 3,
      salMin: 1200000,
      salMax: 2000000,
      status: "ACTIVE",
      createdById: ID.user.taasSales1,
      approvedById: ID.user.taasAdmin,
      closedById: null,
      daysAgo: 25,
    },
    {
      id: ID.req.r20002,
      code: "SFJ-R-20002",
      title: "Kubernetes Platform Engineer",
      clientId: ID.client.tcs,
      buId: ID.bu.taas,
      jobType: "CONTRACT",
      remoteType: "HYBRID",
      priority: "HIGH",
      openings: 2,
      salMin: 1500000,
      salMax: 2500000,
      status: "ACTIVE",
      createdById: ID.user.taasSales1,
      approvedById: ID.user.taasAdmin,
      closedById: null,
      daysAgo: 22,
    },
    {
      id: ID.req.r20003,
      code: "SFJ-R-20003",
      title: "Data Scientist (ML)",
      clientId: ID.client.tcs,
      buId: ID.bu.taas,
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      priority: "MEDIUM",
      openings: 2,
      salMin: 1000000,
      salMax: 1800000,
      status: "ACTIVE",
      createdById: ID.user.taasSales2,
      approvedById: ID.user.taasAdmin,
      closedById: null,
      daysAgo: 18,
    },
    {
      id: ID.req.r20004,
      code: "SFJ-R-20004",
      title: "Salesforce Developer",
      clientId: ID.client.tcs,
      buId: ID.bu.taas,
      jobType: "CONTRACT_TO_HIRE",
      remoteType: "ONSITE",
      priority: "LOW",
      openings: 1,
      salMin: 800000,
      salMax: 1400000,
      status: "PENDING_APPROVAL",
      createdById: ID.user.taasSales2,
      approvedById: null,
      closedById: null,
      daysAgo: 7,
    },
    // ── TaaS / Cognizant ──
    {
      id: ID.req.r20005,
      code: "SFJ-R-20005",
      title: "SAP S/4 HANA Consultant",
      clientId: ID.client.cognizant,
      buId: ID.bu.taas,
      jobType: "CONTRACT",
      remoteType: "ONSITE",
      priority: "HIGH",
      openings: 4,
      salMin: 1500000,
      salMax: 2800000,
      status: "ACTIVE",
      createdById: ID.user.taasSales2,
      approvedById: ID.user.taasAdmin,
      closedById: null,
      daysAgo: 40,
    },
    {
      id: ID.req.r20006,
      code: "SFJ-R-20006",
      title: "Oracle DBA",
      clientId: ID.client.cognizant,
      buId: ID.bu.taas,
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      priority: "MEDIUM",
      openings: 2,
      salMin: 900000,
      salMax: 1600000,
      status: "ACTIVE",
      createdById: ID.user.taasSales3,
      approvedById: ID.user.taasAdmin,
      closedById: null,
      daysAgo: 35,
    },
    {
      id: ID.req.r20007,
      code: "SFJ-R-20007",
      title: "Tableau BI Developer",
      clientId: ID.client.cognizant,
      buId: ID.bu.taas,
      jobType: "CONTRACT",
      remoteType: "REMOTE",
      priority: "LOW",
      openings: 1,
      salMin: 700000,
      salMax: 1100000,
      status: "ON_HOLD",
      createdById: ID.user.taasSales3,
      approvedById: ID.user.taasAdmin,
      closedById: null,
      daysAgo: 50,
    },
    // ── TaaS / LTI ──
    {
      id: ID.req.r20008,
      code: "SFJ-R-20008",
      title: "Angular Developer (v16+)",
      clientId: ID.client.lti,
      buId: ID.bu.taas,
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      priority: "MEDIUM",
      openings: 3,
      salMin: 800000,
      salMax: 1400000,
      status: "ACTIVE",
      createdById: ID.user.taasSales4,
      approvedById: ID.user.taasAdmin,
      closedById: null,
      daysAgo: 14,
    },
    {
      id: ID.req.r20009,
      code: "SFJ-R-20009",
      title: "Java Microservices Architect",
      clientId: ID.client.lti,
      buId: ID.bu.taas,
      jobType: "CONTRACT",
      remoteType: "ONSITE",
      priority: "HIGH",
      openings: 1,
      salMin: 2500000,
      salMax: 4000000,
      status: "ACTIVE",
      createdById: ID.user.taasSales4,
      approvedById: ID.user.taasAdmin,
      closedById: null,
      daysAgo: 12,
    },
    {
      id: ID.req.r20010,
      code: "SFJ-R-20010",
      title: "Product Manager (FinTech)",
      clientId: ID.client.lti,
      buId: ID.bu.taas,
      jobType: "PERMANENT",
      remoteType: "REMOTE",
      priority: "MEDIUM",
      openings: 1,
      salMin: 1800000,
      salMax: 3000000,
      status: "CLOSED",
      createdById: ID.user.taasSales1,
      approvedById: ID.user.taasAdmin,
      closedById: ID.user.taasAdmin,
      daysAgo: 95,
    },
    // ── TaaS / Persistent ──
    {
      id: ID.req.r20011,
      code: "SFJ-R-20011",
      title: "Embedded C Engineer",
      clientId: ID.client.persistent,
      buId: ID.bu.taas,
      jobType: "PERMANENT",
      remoteType: "ONSITE",
      priority: "LOW",
      openings: 2,
      salMin: 600000,
      salMax: 1000000,
      status: "CANCELLED",
      createdById: ID.user.taasSales1,
      approvedById: ID.user.taasAdmin,
      closedById: ID.user.taasAdmin,
      daysAgo: 100,
    },
    {
      id: ID.req.r20012,
      code: "SFJ-R-20012",
      title: "VLSI Design Engineer",
      clientId: ID.client.persistent,
      buId: ID.bu.taas,
      jobType: "PERMANENT",
      remoteType: "ONSITE",
      priority: "MEDIUM",
      openings: 1,
      salMin: 800000,
      salMax: 1400000,
      status: "DRAFT",
      createdById: ID.user.taasSales2,
      approvedById: null,
      closedById: null,
      daysAgo: 3,
    },
    {
      id: ID.req.r20013,
      code: "SFJ-R-20013",
      title: "Agile Coach",
      clientId: ID.client.cognizant,
      buId: ID.bu.taas,
      jobType: "CONTRACT_TO_HIRE",
      remoteType: "HYBRID",
      priority: "MEDIUM",
      openings: 1,
      salMin: 1200000,
      salMax: 2000000,
      status: "ACTIVE",
      createdById: ID.user.taasSales3,
      approvedById: ID.user.taasAdmin,
      closedById: null,
      daysAgo: 6,
    },
  ];

  for (const r of reqDefs) {
    const isClosed = ["CLOSED", "CANCELLED"].includes(r.status);
    await prisma.requirement.upsert({
      where: { id: r.id },
      update: {},
      create: {
        id: r.id,
        reqCode: r.code,
        title: r.title,
        clientId: r.clientId,
        businessUnitId: r.buId,
        jobType: r.jobType,
        remoteType: r.remoteType,
        priority: r.priority,
        totalOpenings: r.openings,
        salaryMin: r.salMin,
        salaryMax: r.salMax,
        salaryType: "ANNUAL",
        status: r.status,
        location: r.buId === ID.bu.kaas ? "Bangalore" : "Chennai",
        country: "India",
        createdById: r.createdById,
        ...(r.approvedById
          ? { approvedById: r.approvedById, approvedAt: daysAgo(r.daysAgo - 2) }
          : {}),
        ...(isClosed ? { closedById: r.closedById, closedAt: daysAgo(3) } : {}),
        createdAt: daysAgo(r.daysAgo),
      },
    });
  }
  console.log("  ✅ 25 requirements\n");

  // ──────────────────────────────────────
  // 10. REQUIREMENT SKILLS — using skillId FK
  // ──────────────────────────────────────
  console.log("🔧 Requirement skills...");

  // [reqId, [[skillId, isMandatory], ...]]
  const reqSkills = [
    [
      ID.req.r10001,
      [
        [ID.skill.java, true],
        [ID.skill.springBoot, true],
        [ID.skill.microservices, true],
        [ID.skill.docker, false],
        [ID.skill.kafka, false],
      ],
    ],
    [
      ID.req.r10002,
      [
        [ID.skill.react, true],
        [ID.skill.typescript, true],
        [ID.skill.nextjs, false],
        [ID.skill.tailwind, false],
      ],
    ],
    [
      ID.req.r10003,
      [
        [ID.skill.aws, true],
        [ID.skill.terraform, true],
        [ID.skill.cicd, true],
        [ID.skill.kubernetes, false],
      ],
    ],
    [
      ID.req.r10004,
      [
        [ID.skill.python, true],
        [ID.skill.spark, true],
        [ID.skill.airflow, false],
        [ID.skill.sql, true],
      ],
    ],
    [
      ID.req.r10006,
      [
        [ID.skill.fico, true],
        [ID.skill.abap, true],
        [ID.skill.sapHana, false],
      ],
    ],
    [
      ID.req.r10008,
      [
        [ID.skill.nodejs, true],
        [ID.skill.express, true],
        [ID.skill.postgresql, true],
        [ID.skill.redis, false],
      ],
    ],
    [
      ID.req.r10009,
      [
        [ID.skill.azure, true],
        [ID.skill.aks, true],
        [ID.skill.terraform, true],
        [ID.skill.kubernetes, false],
      ],
    ],
    [
      ID.req.r20001,
      [
        [ID.skill.golang, true],
        [ID.skill.grpc, true],
        [ID.skill.postgresql, true],
        [ID.skill.redis, false],
      ],
    ],
    [
      ID.req.r20002,
      [
        [ID.skill.kubernetes, true],
        [ID.skill.helm, true],
        [ID.skill.cicd, false],
      ],
    ],
    [
      ID.req.r20003,
      [
        [ID.skill.python, true],
        [ID.skill.tensorflow, true],
        [ID.skill.mlflow, false],
        [ID.skill.sql, true],
      ],
    ],
    [
      ID.req.r20005,
      [
        [ID.skill.sapHana, true],
        [ID.skill.abap, true],
        [ID.skill.fico, true],
      ],
    ],
    [
      ID.req.r20006,
      [
        [ID.skill.oracleDba, true],
        [ID.skill.sql, true],
      ],
    ],
    [
      ID.req.r20007,
      [
        [ID.skill.tableau, true],
        [ID.skill.sql, false],
      ],
    ],
    [
      ID.req.r20008,
      [
        [ID.skill.angular, true],
        [ID.skill.typescript, true],
      ],
    ],
    [
      ID.req.r20009,
      [
        [ID.skill.java, true],
        [ID.skill.springCloud, true],
        [ID.skill.kafka, true],
        [ID.skill.aws, false],
      ],
    ],
    [
      ID.req.r20013,
      [
        [ID.skill.kubernetes, false],
        [ID.skill.cicd, false],
      ],
    ],
  ];

  for (const [requirementId, skills] of reqSkills) {
    for (const [skillId, isMandatory] of skills) {
      await prisma.requirementSkill.upsert({
        where: { requirementId_skillId: { requirementId, skillId } },
        update: {},
        create: { requirementId, skillId, isMandatory },
      });
    }
  }
  console.log("  ✅ Requirement skills linked via FK\n");

  // ──────────────────────────────────────
  // 11. REQUIREMENT ASSIGNMENTS — full chains
  // Chain: MANAGER → TEAM → INDIVIDUAL(s)
  // ──────────────────────────────────────
  console.log("🔗 Assignment chains...");

  // [reqId, dmId, teamId, tlId, recruiterIds[], adminAssignerId]
  const chainDefs = [
    {
      reqId: ID.req.r10001,
      dmId: ID.user.kaasDM1,
      teamId: ID.team.joesTeam,
      tlId: ID.user.kaasTL1,
      rIds: [ID.user.kaasR1, ID.user.kaasR2],
      admin: ID.user.kaasAdmin,
    },
    {
      reqId: ID.req.r10002,
      dmId: ID.user.kaasDM1,
      teamId: ID.team.joesTeam,
      tlId: ID.user.kaasTL1,
      rIds: [ID.user.kaasR1],
      admin: ID.user.kaasAdmin,
    },
    {
      reqId: ID.req.r10003,
      dmId: ID.user.kaasDM2,
      teamId: ID.team.alphaSquad,
      tlId: ID.user.kaasTL2,
      rIds: [ID.user.kaasR3, ID.user.kaasR4],
      admin: ID.user.kaasAdmin,
    },
    {
      reqId: ID.req.r10004,
      dmId: ID.user.kaasDM2,
      teamId: ID.team.alphaSquad,
      tlId: ID.user.kaasTL2,
      rIds: [ID.user.kaasR5, ID.user.kaasR6, ID.user.kaasR7],
      admin: ID.user.kaasAdmin,
    },
    {
      reqId: ID.req.r10006,
      dmId: ID.user.kaasDM3,
      teamId: ID.team.betaSquad,
      tlId: ID.user.kaasTL3,
      rIds: [ID.user.kaasR8, ID.user.kaasR9],
      admin: ID.user.kaasAdmin,
    },
    {
      reqId: ID.req.r10008,
      dmId: ID.user.kaasDM3,
      teamId: ID.team.betaSquad,
      tlId: ID.user.kaasTL3,
      rIds: [ID.user.kaasR10, ID.user.kaasR11, ID.user.kaasR12],
      admin: ID.user.kaasAdmin,
    },
    {
      reqId: ID.req.r10009,
      dmId: ID.user.kaasDM2,
      teamId: ID.team.alphaSquad,
      tlId: ID.user.kaasTL2,
      rIds: [ID.user.kaasR3],
      admin: ID.user.kaasAdmin,
    },
    {
      reqId: ID.req.r10013,
      dmId: ID.user.kaasDM1,
      teamId: ID.team.joesTeam,
      tlId: ID.user.kaasTL4,
      rIds: [ID.user.kaasR13],
      admin: ID.user.kaasAdmin,
    },
    {
      reqId: ID.req.r20001,
      dmId: ID.user.taasDM1,
      teamId: ID.team.deltaTeam,
      tlId: ID.user.taasTL1,
      rIds: [ID.user.taasR1, ID.user.taasR2],
      admin: ID.user.taasAdmin,
    },
    {
      reqId: ID.req.r20002,
      dmId: ID.user.taasDM1,
      teamId: ID.team.deltaTeam,
      tlId: ID.user.taasTL1,
      rIds: [ID.user.taasR3, ID.user.taasR4],
      admin: ID.user.taasAdmin,
    },
    {
      reqId: ID.req.r20003,
      dmId: ID.user.taasDM2,
      teamId: ID.team.gammaTeam,
      tlId: ID.user.taasTL2,
      rIds: [ID.user.taasR6, ID.user.taasR7],
      admin: ID.user.taasAdmin,
    },
    {
      reqId: ID.req.r20005,
      dmId: ID.user.taasDM1,
      teamId: ID.team.deltaTeam,
      tlId: ID.user.taasTL1,
      rIds: [ID.user.taasR1, ID.user.taasR2, ID.user.taasR5],
      admin: ID.user.taasAdmin,
    },
    {
      reqId: ID.req.r20006,
      dmId: ID.user.taasDM2,
      teamId: ID.team.gammaTeam,
      tlId: ID.user.taasTL3,
      rIds: [ID.user.taasR11, ID.user.taasR12],
      admin: ID.user.taasAdmin,
    },
    {
      reqId: ID.req.r20008,
      dmId: ID.user.taasDM2,
      teamId: ID.team.gammaTeam,
      tlId: ID.user.taasTL2,
      rIds: [ID.user.taasR8, ID.user.taasR9],
      admin: ID.user.taasAdmin,
    },
    {
      reqId: ID.req.r20009,
      dmId: ID.user.taasDM1,
      teamId: ID.team.deltaTeam,
      tlId: ID.user.taasTL1,
      rIds: [ID.user.taasR3],
      admin: ID.user.taasAdmin,
    },
    {
      reqId: ID.req.r20013,
      dmId: ID.user.taasDM2,
      teamId: ID.team.gammaTeam,
      tlId: ID.user.taasTL3,
      rIds: [ID.user.taasR11, ID.user.taasR12],
      admin: ID.user.taasAdmin,
    },
  ];

  for (const c of chainDefs) {
    const existing = await prisma.requirementAssignment.count({
      where: { requirementId: c.reqId },
    });
    if (existing > 0) continue;

    const req = reqDefs.find((r) => r.id === c.reqId);
    const openings = req?.openings ?? 1;
    const perRecruiter = Math.ceil(openings / c.rIds.length);

    // Level 1 — MANAGER
    const managerAssignment = await prisma.requirementAssignment.create({
      data: {
        requirementId: c.reqId,
        assignmentType: "MANAGER",
        status: "ACTIVE",
        recruiterId: c.dmId,
        allocatedOpenings: openings,
        assignedById: c.admin,
      },
    });

    // Level 2 — TEAM
    const teamAssignment = await prisma.requirementAssignment.create({
      data: {
        requirementId: c.reqId,
        assignmentType: "TEAM",
        status: "ACTIVE",
        teamId: c.teamId,
        allocatedOpenings: openings,
        assignedById: c.dmId,
        parentAssignmentId: managerAssignment.id,
      },
    });

    // Level 3 — INDIVIDUAL recruiters
    for (const recruiterId of c.rIds) {
      // look up TeamMember for this recruiter in this team
      const member = await prisma.teamMember.findUnique({
        where: { userId_teamId: { userId: recruiterId, teamId: c.teamId } },
      });
      await prisma.requirementAssignment.create({
        data: {
          requirementId: c.reqId,
          assignmentType: "INDIVIDUAL",
          status: "ACTIVE",
          recruiterId,
          teamMemberId: member?.id ?? null,
          allocatedOpenings: perRecruiter,
          assignedById: c.tlId,
          parentAssignmentId: teamAssignment.id,
        },
      });
    }
  }
  console.log("  ✅ Assignment chains (MANAGER → TEAM → INDIVIDUAL)\n");

  // ──────────────────────────────────────
  // 12. REQUIREMENT STATUS HISTORIES
  // ──────────────────────────────────────
  console.log("📜 Status histories...");

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

  const statusReasons = {
    ACTIVE: "Approved and activated",
    ON_HOLD: "Client requested hold — headcount review in progress",
    CLOSED: "All positions filled",
    CANCELLED: "Requirement withdrawn by client",
  };

  for (const r of reqDefs) {
    const existing = await prisma.requirementStatusHistory.count({
      where: { requirementId: r.id },
    });
    if (existing > 0) continue;

    const flow = statusFlows[r.status] ?? [];
    for (let i = 0; i < flow.length; i++) {
      const [fromStatus, toStatus] = flow[i];
      const changedById =
        toStatus === "ACTIVE" ? r.approvedById ?? r.createdById : r.createdById;
      await prisma.requirementStatusHistory.create({
        data: {
          requirementId: r.id,
          fromStatus,
          toStatus,
          changedById,
          reason: statusReasons[toStatus] ?? null,
          changedAt: daysAgo(r.daysAgo - i * 3),
        },
      });
    }
  }
  console.log("  ✅ Status histories\n");

  // ──────────────────────────────────────
  // 13. REQUIREMENT ACTIVITIES
  // ──────────────────────────────────────
  console.log("📡 Activity feeds...");

  for (const r of reqDefs) {
    const existing = await prisma.requirementActivity.count({
      where: { requirementId: r.id },
    });
    if (existing > 0) continue;

    const activities = [
      {
        actorId: r.createdById,
        type: "REQUIREMENT_CREATED",
        summary: `Requirement ${r.code} created`,
        createdAt: daysAgo(r.daysAgo),
      },
    ];
    if (r.approvedById) {
      activities.push({
        actorId: r.approvedById,
        type: "REQUIREMENT_APPROVED",
        summary: `Requirement ${r.code} approved and activated`,
        createdAt: daysAgo(r.daysAgo - 2),
      });
    }
    if (r.status === "CLOSED") {
      activities.push({
        actorId: r.closedById ?? r.approvedById,
        type: "REQUIREMENT_CLOSED",
        summary: "All positions filled — requirement closed",
        createdAt: daysAgo(3),
      });
    }
    if (r.status === "CANCELLED") {
      activities.push({
        actorId: r.closedById ?? r.createdById,
        type: "STATUS_CHANGED",
        summary: "Requirement cancelled by client",
        createdAt: daysAgo(3),
      });
    }

    await prisma.requirementActivity.createMany({
      data: activities.map((a) => ({ requirementId: r.id, ...a })),
    });
  }
  console.log("  ✅ Activity feeds\n");

  // ──────────────────────────────────────
  // 14. REQUIREMENT NOTES
  // ──────────────────────────────────────
  console.log("📝 Notes...");

  const noteDefs = [
    {
      reqId: ID.req.r10001,
      authorId: ID.user.kaasSales1,
      content:
        "Client confirmed headcount. Looking for immediate joiners only.",
    },
    {
      reqId: ID.req.r10002,
      authorId: ID.user.kaasSales1,
      content:
        "Strong preference for candidates from product companies. Notice period max 30 days.",
    },
    {
      reqId: ID.req.r10004,
      authorId: ID.user.kaasSales2,
      content:
        "Budget approved. 4 positions — can split 2+2 across two squads if needed.",
    },
    {
      reqId: ID.req.r10008,
      authorId: ID.user.kaasSales3,
      content:
        "Hybrid — 3 days onsite in Bangalore. Client open to remote-first profiles with travel.",
    },
    {
      reqId: ID.req.r20001,
      authorId: ID.user.taasSales1,
      content:
        "Golang profiles rare in market — extend notice period window to 60 days.",
    },
    {
      reqId: ID.req.r20005,
      authorId: ID.user.taasSales2,
      content:
        "FICO + SD combo preferred. SAP certified candidates get priority shortlisting.",
    },
    {
      reqId: ID.req.r20009,
      authorId: ID.user.taasSales4,
      content:
        "Only 1 opening but client is very selective. Expect 3+ interview rounds.",
    },
  ];

  for (const n of noteDefs) {
    const existing = await prisma.requirementNote.count({
      where: { requirementId: n.reqId },
    });
    if (existing === 0) {
      await prisma.requirementNote.create({
        data: {
          requirementId: n.reqId,
          authorId: n.authorId,
          content: n.content,
        },
      });
    }
  }
  console.log("  ✅ Notes\n");

  // ──────────────────────────────────────
  // DONE
  // ──────────────────────────────────────
  console.log("🎉 Seed complete!\n");
  console.log(
    "┌─────────────────────────────────────────────────────────────┐"
  );
  console.log(
    "│  DATASET SUMMARY                                            │"
  );
  console.log(
    "├─────────────────────────────────────────────────────────────┤"
  );
  console.log(
    "│  Roles              6                                        │"
  );
  console.log(
    "│  Business Units     2   KaaS BU · TaaS BU                   │"
  );
  console.log(
    "│  Teams             11   5 KaaS + 4 TaaS + 2 roots           │"
  );
  console.log(
    "│  Team Edges        27   9 pairs × 3 edge types              │"
  );
  console.log(
    "│  Users             50                                        │"
  );
  console.log(
    "│  Skills            36   canonical registry with aliases      │"
  );
  console.log(
    "│  Clients            8   4 KaaS · 4 TaaS                     │"
  );
  console.log(
    "│  Requirements      25   13 KaaS · 12 TaaS                   │"
  );
  console.log(
    "│  Assignment Chains 16   MANAGER → TEAM → INDIVIDUAL         │"
  );
  console.log(
    "├─────────────────────────────────────────────────────────────┤"
  );
  console.log(
    "│  KEY LOGINS                                                  │"
  );
  console.log(
    "│  superadmin@talentos.com       Admin@123  SUPER_ADMIN        │"
  );
  console.log(
    "│  admin.kaas@talentos.com       Admin@123  ADMIN (KaaS)       │"
  );
  console.log(
    "│  admin.taas@talentos.com       Admin@123  ADMIN (TaaS)       │"
  );
  console.log(
    "│  dm1.kaas@talentos.com         Pass@123   DELIVERY_MANAGER   │"
  );
  console.log(
    "│  tl1.kaas@talentos.com         Pass@123   TEAM_LEAD          │"
  );
  console.log(
    "│  r01.kaas@talentos.com         Pass@123   RECRUITER          │"
  );
  console.log(
    "│  sales1.kaas@talentos.com      Pass@123   SALES              │"
  );
  console.log(
    "│  dm1.taas@talentos.com         Pass@123   DELIVERY_MANAGER   │"
  );
  console.log(
    "│  tl1.taas@talentos.com         Pass@123   TEAM_LEAD          │"
  );
  console.log(
    "│  r01.taas@talentos.com         Pass@123   RECRUITER          │"
  );
  console.log(
    "├─────────────────────────────────────────────────────────────┤"
  );
  console.log(
    "│  KaaS TREE                                                   │"
  );
  console.log(
    "│  KaaS Ecosystem                                              │"
  );
  console.log(
    "│    ├── KaaS Sales Team   (Sneha LEAD + 4 sales)             │"
  );
  console.log(
    "│    └── KaaS Delivery     (Papitha LEAD)                     │"
  );
  console.log(
    "│          ├── Joe's Team  (Joe + Divya CO_LEAD + 4 recruiters)│"
  );
  console.log(
    "│          ├── Alpha Squad (Ananya LEAD + 5 recruiters)        │"
  );
  console.log(
    "│          └── Beta Squad  (Vikram LEAD + 5 recruiters)        │"
  );
  console.log(
    "│  TaaS TREE                                                   │"
  );
  console.log(
    "│  TaaS Ecosystem                                              │"
  );
  console.log(
    "│    ├── TaaS Sales Team   (Balaji LEAD + 3 sales)            │"
  );
  console.log(
    "│    └── TaaS Delivery     (Karthik LEAD)                     │"
  );
  console.log(
    "│          ├── Delta Team  (Varun LEAD + 5 recruiters)         │"
  );
  console.log(
    "│          └── Gamma Team  (Naveen LEAD + Yamini CO_LEAD + 7)  │"
  );
  console.log(
    "└─────────────────────────────────────────────────────────────┘"
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
