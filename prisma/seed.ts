import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ─── helpers ─────────────────────────────────────────────────────────────────
const hash = (p: string) => bcrypt.hashSync(p, 10);
const now = new Date();

async function main() {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║           SFJ Seed Starting              ║");
  console.log("╚══════════════════════════════════════════╝\n");

  // ─────────────────────────────────────────────────────────────────────────
  // ROLES
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding roles...");

  const roleSuperAdmin = await prisma.role.upsert({
    where: { name: "Super Admin" },
    update: {},
    create: {
      name: "Super Admin",
      description: "Full system access",
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
        ],
      },
    },
  });

  const roleDeliveryManager = await prisma.role.upsert({
    where: { name: "Delivery Manager" },
    update: {},
    create: {
      name: "Delivery Manager",
      description: "Manages delivery teams and requirements",
      permissions: {
        create: [
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
            scope: "BU",
          },
          {
            module: "requirements",
            canView: true,
            canAdd: true,
            canEdit: true,
            canDelete: false,
            scope: "TEAM",
          },
        ],
      },
    },
  });

  const roleRecruiter = await prisma.role.upsert({
    where: { name: "Recruiter" },
    update: {},
    create: {
      name: "Recruiter",
      description: "Works on assigned requirements",
      permissions: {
        create: [
          {
            module: "users",
            canView: true,
            canAdd: false,
            canEdit: false,
            canDelete: false,
            scope: "OWN",
          },
          {
            module: "requirements",
            canView: true,
            canAdd: false,
            canEdit: true,
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

  const roleSalesLead = await prisma.role.upsert({
    where: { name: "Sales Lead" },
    update: {},
    create: {
      name: "Sales Lead",
      description: "Leads sales team, manages clients",
      permissions: {
        create: [
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
            canEdit: false,
            canDelete: false,
            scope: "BU",
          },
        ],
      },
    },
  });

  const roleSales = await prisma.role.upsert({
    where: { name: "Sales" },
    update: {},
    create: {
      name: "Sales",
      description: "Sales team member",
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
          {
            module: "users",
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

  const roleHR = await prisma.role.upsert({
    where: { name: "HR / CSR Lead" },
    update: {},
    create: {
      name: "HR / CSR Lead",
      description: "HR and CSR operations lead",
      permissions: {
        create: [
          {
            module: "users",
            canView: true,
            canAdd: true,
            canEdit: true,
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
            module: "requirements",
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

  console.log("  ✓ 6 roles created\n");

  // ─────────────────────────────────────────────────────────────────────────
  // BUSINESS UNITS
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding business units...");

  const buEnterprise = await prisma.businessUnit.upsert({
    where: { name: "Enterprise" },
    update: {},
    create: { name: "Enterprise", isActive: true },
  });

  const buB2G = await prisma.businessUnit.upsert({
    where: { name: "B2G" },
    update: {},
    create: { name: "B2G", isActive: true, parentBUId: buEnterprise.id },
  });

  const buB2I = await prisma.businessUnit.upsert({
    where: { name: "B2I" },
    update: {},
    create: { name: "B2I", isActive: true, parentBUId: buEnterprise.id },
  });

  console.log("  ✓ Enterprise (root) → B2G, B2I\n");

  // ─────────────────────────────────────────────────────────────────────────
  // SUPER ADMIN USER — Siva Sarathy
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding super admin...");

  const userSiva = await prisma.user.upsert({
    where: { email: "siva.sarathy@sfjbs.com" },
    update: {},
    create: {
      email: "siva.sarathy@sfjbs.com",
      passwordHash: hash("admin@123"),
      firstName: "Siva",
      lastName: "Sarathy",
      employeeId: "SFJ-CEO-001",
      isSuperAdmin: true,
      isActive: true,
      roleId: roleSuperAdmin.id,
    },
  });

  console.log("  ✓ Siva Sarathy — siva.sarathy@sfjbs.com / admin@123\n");

  // ─────────────────────────────────────────────────────────────────────────
  // TEAM ARCS
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding team arcs...");

  const arcKaaS = await prisma.teamArc.upsert({
    where: {
      businessUnitId_name: {
        businessUnitId: buEnterprise.id,
        name: "KaaS Arc",
      },
    },
    update: {},
    create: {
      name: "KaaS Arc",
      description: "Knowledge as a Service delivery",
      businessUnitId: buEnterprise.id,
    },
  });

  const arcTaaS = await prisma.teamArc.upsert({
    where: {
      businessUnitId_name: {
        businessUnitId: buEnterprise.id,
        name: "TaaS Arc",
      },
    },
    update: {},
    create: {
      name: "TaaS Arc",
      description: "Talent as a Service delivery",
      businessUnitId: buEnterprise.id,
    },
  });

  const arcCSR = await prisma.teamArc.upsert({
    where: {
      businessUnitId_name: { businessUnitId: buEnterprise.id, name: "CSR Arc" },
    },
    update: {},
    create: {
      name: "CSR Arc",
      description: "CSR and HR operations",
      businessUnitId: buEnterprise.id,
    },
  });

  const arcB2G = await prisma.teamArc.upsert({
    where: {
      businessUnitId_name: { businessUnitId: buB2G.id, name: "B2G Arc" },
    },
    update: {},
    create: {
      name: "B2G Arc",
      description: "B2G skilling and delivery",
      businessUnitId: buB2G.id,
    },
  });

  console.log("  ✓ KaaS Arc, TaaS Arc, CSR Arc (Enterprise) · B2G Arc (B2G)\n");

  // ─────────────────────────────────────────────────────────────────────────
  // TEAMS
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding teams...");

  const mkTeam = async (
    name: string,
    arcId: string,
    buId: string,
    category: string,
    nodeType = "GROUP"
  ) =>
    prisma.team.upsert({
      where: { id: `team-${name.replace(/\s/g, "-").toLowerCase()}` },
      update: {},
      create: {
        id: `team-${name.replace(/\s/g, "-").toLowerCase()}`,
        name,
        teamArcId: arcId,
        businessUnitId: buId,
        category: category as any,
        nodeType: nodeType as any,
        isActive: true,
      },
    });

  // KaaS teams
  const teamKaaSales = await mkTeam(
    "KaaS Sales",
    arcKaaS.id,
    buEnterprise.id,
    "SALES"
  );
  const teamKaaDelvKart = await mkTeam(
    "KaaS_Delivery_Karthik",
    arcKaaS.id,
    buEnterprise.id,
    "DELIVERY"
  );
  const teamKaaDelvLiki = await mkTeam(
    "KaaS_Delivery_Likitha",
    arcKaaS.id,
    buEnterprise.id,
    "DELIVERY"
  );
  const teamKaaDelvSara = await mkTeam(
    "KaaS_Delivery_Sarala",
    arcKaaS.id,
    buEnterprise.id,
    "DELIVERY"
  );
  const teamKaaSIMS = await mkTeam(
    "KaaS_IMS",
    arcKaaS.id,
    buEnterprise.id,
    "SUPPORT"
  );

  // TaaS teams
  const teamTaaSRoja = await mkTeam(
    "TaaS_Delivery_Roja",
    arcTaaS.id,
    buEnterprise.id,
    "DELIVERY"
  );
  const teamTaaSYesv = await mkTeam(
    "TaaS_Yesvanth",
    arcTaaS.id,
    buEnterprise.id,
    "DELIVERY"
  );

  // CSR teams
  const teamCSR = await mkTeam("CSR", arcCSR.id, buEnterprise.id, "SUPPORT");
  const teamCSRCluster1 = await mkTeam(
    "CSR_Cluster1",
    arcCSR.id,
    buEnterprise.id,
    "SUPPORT"
  );
  const teamCSRCluster3 = await mkTeam(
    "CSR_Cluster3",
    arcCSR.id,
    buEnterprise.id,
    "SUPPORT"
  );

  // B2G teams
  const teamB2GHiring = await mkTeam(
    "B2G & B2I_Internal Hiring",
    arcB2G.id,
    buB2G.id,
    "DELIVERY"
  );
  const teamB2GCluster1 = await mkTeam(
    "B2G_Cluster 1",
    arcB2G.id,
    buB2G.id,
    "DELIVERY"
  );
  const teamB2GCluster4 = await mkTeam(
    "B2G_Cluster 4",
    arcB2G.id,
    buB2G.id,
    "DELIVERY"
  );
  const teamB2GShylaja = await mkTeam(
    "B2G_Delivery_Shylaja",
    arcB2G.id,
    buB2G.id,
    "DELIVERY"
  );

  console.log("  ✓ 14 teams created\n");

  // ─────────────────────────────────────────────────────────────────────────
  // USERS — all 73 employees
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding users...");

  const DEFAULT_PASS = hash("pass@123");

  // Helper — upsert user
  const mkUser = async (opts: {
    empId: string;
    email: string;
    firstName: string;
    lastName: string;
    roleId: string;
    buId: string;
    phone?: string;
    designation?: string;
  }) =>
    prisma.user.upsert({
      where: { email: opts.email },
      update: {},
      create: {
        email: opts.email,
        passwordHash: DEFAULT_PASS,
        firstName: opts.firstName,
        lastName: opts.lastName,
        employeeId: opts.empId,
        phone: opts.phone,
        isActive: true,
        roleId: opts.roleId,
        businessUnitId: opts.buId,
        createdById: userSiva.id,
      },
    });

  // ── KaaS Sales team ──────────────────────────────────────────────────────
  const uRakhi = await mkUser({
    empId: "SFJ-R-9439",
    email: "rakhi.d@sfjbs.com",
    firstName: "Rakhi",
    lastName: "Sen",
    roleId: roleSalesLead.id,
    buId: buEnterprise.id,
    phone: "9972509000",
  });
  const uYatin = await mkUser({
    empId: "SFJ-R-9839",
    email: "anand.y@sfjbs.com",
    firstName: "Yatin",
    lastName: "Anand",
    roleId: roleSalesLead.id,
    buId: buEnterprise.id,
    phone: "7838823000",
  });
  const uAjay = await mkUser({
    empId: "SFJ-R-11794",
    email: "csm23@sfjbs.com",
    firstName: "Ajay",
    lastName: "D",
    roleId: roleSales.id,
    buId: buEnterprise.id,
    phone: "9148529000",
  });
  const uAkash = await mkUser({
    empId: "bS-R-21970",
    email: "impact01@bskilling.com",
    firstName: "Akash",
    lastName: "J",
    roleId: roleSales.id,
    buId: buEnterprise.id,
    phone: "8113051000",
  });
  const uArockiya = await mkUser({
    empId: "bS-R-21979",
    email: "ta7116@sfjbs.com",
    firstName: "Arockiya",
    lastName: "Nirmal Zacharias",
    roleId: roleSales.id,
    buId: buEnterprise.id,
    phone: "6382299000",
  });
  const uKarthK = await mkUser({
    empId: "bS-R-21980",
    email: "ta7119@sfjbs.com",
    firstName: "Karthikeyan",
    lastName: "K",
    roleId: roleSales.id,
    buId: buEnterprise.id,
    phone: "7639590000",
  });
  const uManishaJK = await mkUser({
    empId: "SFJ-R-11201",
    email: "csm04@sfjbs.com",
    firstName: "Manisha",
    lastName: "J Kumar",
    roleId: roleSales.id,
    buId: buEnterprise.id,
    phone: "6281688000",
  });
  const uRadha = await mkUser({
    empId: "bS-R-21971",
    email: "impact02@bskilling.com",
    firstName: "Radha",
    lastName: "A",
    roleId: roleSales.id,
    buId: buEnterprise.id,
    phone: "9080205000",
  });
  const uRitu = await mkUser({
    empId: "SFJ-R-11526",
    email: "ta221@sfjbs.com",
    firstName: "Ritu",
    lastName: "Seharawat",
    roleId: roleSales.id,
    buId: buEnterprise.id,
    phone: "9902201000",
  });
  const uSoma = await mkUser({
    empId: "SFJ-R-11890",
    email: "csm19@sfjbs.com",
    firstName: "Somashekar",
    lastName: "P M",
    roleId: roleSales.id,
    buId: buEnterprise.id,
    phone: "9342768000",
  });
  const uSyedS = await mkUser({
    empId: "bS-R-21931",
    email: "ta7180@sfjbs.com",
    firstName: "Syed",
    lastName: "Sameer",
    roleId: roleSales.id,
    buId: buEnterprise.id,
    phone: "7673963000",
  });

  // ── KaaS Delivery — Karthik ───────────────────────────────────────────────
  const uSaijal = await mkUser({
    empId: "SFJ-R-9323",
    email: "saijal.s@sfjbs.com",
    firstName: "Saijal",
    lastName: "S",
    roleId: roleDeliveryManager.id,
    buId: buEnterprise.id,
    phone: "7950827000",
  });
  const uKarthDM = await mkUser({
    empId: "SFJ-R-9771",
    email: "ta123@sfjbs.com",
    firstName: "Karthikeyan",
    lastName: "Ganeshan",
    roleId: roleDeliveryManager.id,
    buId: buEnterprise.id,
    phone: "8884050000",
  });
  const uAbhilash = await mkUser({
    empId: "SFJ-R-11909",
    email: "ta7159@sfjbs.com",
    firstName: "Abhilash",
    lastName: "V S",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "7012913000",
  });
  const uMunaff = await mkUser({
    empId: "SFJ-R-11434",
    email: "ta7142@sfjbs.com",
    firstName: "Mohammed",
    lastName: "Munaff",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "8884252000",
  });
  const uPrakash = await mkUser({
    empId: "SFJ-R-12027",
    email: "ta7166@sfjbs.com",
    firstName: "Prakashkumar",
    lastName: "M",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "7904210000",
  });
  const uRaviPT = await mkUser({
    empId: "bS-R-21905",
    email: "ta7133@sfjbs.com",
    firstName: "Ravi",
    lastName: "Prakash Tiwari",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "9990611000",
  });
  const uSibbala = await mkUser({
    empId: "SFJ-R-11495",
    email: "ta4186@sfjbs.com",
    firstName: "Sibbala",
    lastName: "Ravi Sankar",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "8885314000",
  });
  const uTejash = await mkUser({
    empId: "SFJ-R-11899",
    email: "ta7132@sfjbs.com",
    firstName: "Tejashwini",
    lastName: "M",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "9108382000",
  });

  // ── KaaS Delivery — Likitha ──────────────────────────────────────────────
  const uLikhitha = await mkUser({
    empId: "SFJ-R-11132",
    email: "ta7009@sfjbs.com",
    firstName: "Likhitha",
    lastName: "R",
    roleId: roleDeliveryManager.id,
    buId: buEnterprise.id,
    phone: "9980496000",
  });
  const uLathika = await mkUser({
    empId: "SFJ-R-12009",
    email: "ta7002@sfjbs.com",
    firstName: "Lathika",
    lastName: "Devi S",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "9940027000",
  });
  const uMPooja = await mkUser({
    empId: "SFJ-R-11305",
    email: "ta7102@sfjbs.com",
    firstName: "M",
    lastName: "Pooja",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "9632795000",
  });
  const uNeha = await mkUser({
    empId: "bS-R-22040",
    email: "ta7170@sfjbs.com",
    firstName: "Neha",
    lastName: "Pandey",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "9579013000",
  });
  const uPriyanka = await mkUser({
    empId: "bS-R-22016",
    email: "ta7172@sfjbs.com",
    firstName: "Priyanka",
    lastName: "Singh",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "8709507000",
  });
  const uSavithri = await mkUser({
    empId: "SFJ-R-11931",
    email: "ta226@sfjbs.com",
    firstName: "Savithri",
    lastName: "K",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "9600063000",
  });
  const uSowndhary = await mkUser({
    empId: "bS-R-22043",
    email: "ta4170@sfjbs.com",
    firstName: "Sowndharya",
    lastName: "S",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "8056925000",
  });
  const uVadlamudi = await mkUser({
    empId: "bS-R-21967",
    email: "ta7169@sfjbs.com",
    firstName: "Vadlamudi",
    lastName: "Reddi Prasad",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "9703432000",
  });

  // ── KaaS Delivery — Sarala ───────────────────────────────────────────────
  const uSarala = await mkUser({
    empId: "SFJ-R-22064",
    email: "ta7069@sfjbs.com",
    firstName: "G M",
    lastName: "Sarala",
    roleId: roleDeliveryManager.id,
    buId: buEnterprise.id,
    phone: "8088623000",
  });
  const uGeethika = await mkUser({
    empId: "bS-R-22059",
    email: "ta7162@sfjbs.com",
    firstName: "Geethika",
    lastName: "Palanisamy",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "9361455000",
  });
  const uRamLaksh = await mkUser({
    empId: "bS-R-22049",
    email: "ta305@sfjbs.com",
    firstName: "Ramlakshmanan",
    lastName: "V",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "9629305000",
  });
  const uSamiksh = await mkUser({
    empId: "SFJ-R-12036",
    email: "ta4197@sfjbs.com",
    firstName: "Samikshya",
    lastName: "Sahu",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "6370171000",
  });

  // ── KaaS IMS ─────────────────────────────────────────────────────────────
  const uBhoomika = await mkUser({
    empId: "SFJ-R-10820",
    email: "ta7067@bskilling.com",
    firstName: "Bhoomika",
    lastName: "K",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "7892753000",
  });
  const uMuskanIMS = await mkUser({
    empId: "bS-R-21450",
    email: "ins24@bskilling.com",
    firstName: "Muskan",
    lastName: "(IMS)",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "7625054000",
  });

  // ── TaaS Delivery — Roja ─────────────────────────────────────────────────
  const uMadhavi = await mkUser({
    empId: "SFJ-R-11170",
    email: "hr@sfjbs.com",
    firstName: "Madhavi",
    lastName: "Sengar",
    roleId: roleHR.id,
    buId: buEnterprise.id,
    phone: "7019912000",
  });
  const uRoja = await mkUser({
    empId: "SFJ-R-9628",
    email: "ta104@sfjbs.com",
    firstName: "Roja",
    lastName: "Chennacetty",
    roleId: roleDeliveryManager.id,
    buId: buEnterprise.id,
    phone: "7899725000",
  });
  const uVarna = await mkUser({
    empId: "SFJ-R-9564",
    email: "varnashree.m@sfjbs.com",
    firstName: "Varna",
    lastName: "shree M",
    roleId: roleDeliveryManager.id,
    buId: buEnterprise.id,
    phone: "9632694000",
  });
  const uAkkala = await mkUser({
    empId: "SFJ-R-22055",
    email: "ta4199@sfjbs.com",
    firstName: "Akkaladevi",
    lastName: "Bhagyasree",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "6303499000",
  });
  const uBhushan = await mkUser({
    empId: "bS-R-20525",
    email: "ta204@sfjbs.com",
    firstName: "Bhushana",
    lastName: "Tumati",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "8946035000",
  });
  const uMeenaksh = await mkUser({
    empId: "SFJ-R-11727",
    email: "ta4182@sfjbs.com",
    firstName: "C",
    lastName: "Meenakshi",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "8179395000",
  });
  const uDJamuna = await mkUser({
    empId: "bS-R-22061",
    email: "ta7121@sfjbs.com",
    firstName: "D",
    lastName: "Jamuna",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "7207841000",
  });
  const uDanam = await mkUser({
    empId: "SFJ-R-10876",
    email: "ta334@sfjbs.com",
    firstName: "Danam",
    lastName: "Purnachandra Rao",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "7093245000",
  });
  const uJyothi = await mkUser({
    empId: "SFJ-R-10862",
    email: "ta330@sfjbs.com",
    firstName: "Jyothi",
    lastName: "Jakkula",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "7842432000",
  });
  const uLatha = await mkUser({
    empId: "SFJ-R-9284",
    email: "latha.t@sfjbs.com",
    firstName: "Latha",
    lastName: "Tumati",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "8147087000",
  });
  const uPavan = await mkUser({
    empId: "bS-R-22035",
    email: "ta107@sfjbs.com",
    firstName: "Pavan",
    lastName: "Kumar Chetty",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "9618599000",
  });

  // ── TaaS Delivery — Yesvanth ─────────────────────────────────────────────
  const uYesvanth = await mkUser({
    empId: "SFJ-R-10475",
    email: "yesvanth@sfjbs.com",
    firstName: "Yesvanth",
    lastName: "Kumar",
    roleId: roleSalesLead.id,
    buId: buEnterprise.id,
    phone: "9884102000",
  });
  const uDeivan = await mkUser({
    empId: "SFJ-R-10678",
    email: "cg_captive005@sfjbs.com",
    firstName: "Deivanai",
    lastName: "Subbiah",
    roleId: roleDeliveryManager.id,
    buId: buEnterprise.id,
    phone: "7904599000",
  });
  const uAishw = await mkUser({
    empId: "bS-R-22054",
    email: "cg_captive009@sfjbs.com",
    firstName: "Aishwarya",
    lastName: "(TaaS)",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "7906508000",
  });
  const uHemalD = await mkUser({
    empId: "bS-R-22056",
    email: "cg_captive065@sfjbs.com",
    firstName: "Hemalatha",
    lastName: "D",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "7022881000",
  });
  const uKoduru = await mkUser({
    empId: "bS-R-21919",
    email: "cg_captive039@sfjbs.com",
    firstName: "Koduru",
    lastName: "Chinni Ragavamma",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "9550308000",
  });
  const uPayal = await mkUser({
    empId: "bS-R-22006",
    email: "cg_captive067@sfjbs.com",
    firstName: "Payal",
    lastName: "Kumari",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "9608337000",
  });
  const uRajat = await mkUser({
    empId: "SFJ-R-11590",
    email: "ta7175@sfjbs.com",
    firstName: "Rajat",
    lastName: "(TaaS)",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "9663122000",
  });
  const uSangeetha = await mkUser({
    empId: "SFJ-R-10705",
    email: "cg_captive004@sfjbs.com",
    firstName: "Sangeethapriya",
    lastName: "Yuvarajan",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "8778100000",
  });
  const uSubhasmi = await mkUser({
    empId: "SFJ-R-9843",
    email: "cg_captive007@sfjbs.com",
    firstName: "Subhasmita",
    lastName: "Barik",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "8553943000",
  });
  const uSubhasre = await mkUser({
    empId: "SFJ-R-11062",
    email: "ta425@sfjbs.com",
    firstName: "Subhasree",
    lastName: "Patro",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "7978551000",
  });
  const uVasanth = await mkUser({
    empId: "bS-R-21745",
    email: "cg_captive006@sfjbs.com",
    firstName: "Vasanth",
    lastName: "P",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "9360007000",
  });
  const uVemula = await mkUser({
    empId: "bS-R-22057",
    email: "cg_captive063@sfjbs.com",
    firstName: "Vemula",
    lastName: "Charan",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "6301715000",
  });

  // ── CSR team ──────────────────────────────────────────────────────────────
  const uAnshita = await mkUser({
    empId: "bS-R-22046",
    email: "ta4016@sfjbs.com",
    firstName: "Anshita",
    lastName: "Mishra",
    roleId: roleRecruiter.id,
    buId: buEnterprise.id,
    phone: "7795049000",
  });
  const uMuskanJ = await mkUser({
    empId: "SFJ-R-12006",
    email: "csm25@sfjbs.com",
    firstName: "Muskan",
    lastName: "Jain",
    roleId: roleHR.id,
    buId: buEnterprise.id,
    phone: "9351908000",
  });
  const uAnuj = await mkUser({
    empId: "SFJ-R-12007",
    email: "csr02@sfjbs.com",
    firstName: "Anuj",
    lastName: "Jain",
    roleId: roleHR.id,
    buId: buEnterprise.id,
    phone: "9602711000",
  });
  const uManish = await mkUser({
    empId: "SFJ-R-11977",
    email: "csr03@sfjbs.com",
    firstName: "Manish",
    lastName: "Kumar",
    roleId: roleHR.id,
    buId: buEnterprise.id,
    phone: "9576459000",
  });

  // ── B2G teams ─────────────────────────────────────────────────────────────
  const uJoanna = await mkUser({
    empId: "SFJ-R-11257",
    email: "xcpo@sfjbs.com",
    firstName: "Joanna",
    lastName: "Josh",
    roleId: roleHR.id,
    buId: buB2G.id,
    phone: "0000000000",
  });
  const uDhanesh = await mkUser({
    empId: "bS-R-21898",
    email: "ta4082@sfjbs.com",
    firstName: "Dhanesh",
    lastName: "K",
    roleId: roleRecruiter.id,
    buId: buB2G.id,
    phone: "9495015000",
  });
  const uHemaKB = await mkUser({
    empId: "SFJ-R-11900",
    email: "ta4083@sfjbs.com",
    firstName: "Kalyanabailu",
    lastName: "Hemalatha",
    roleId: roleRecruiter.id,
    buId: buB2G.id,
    phone: "9110767000",
  });
  const uMenka = await mkUser({
    empId: "SFJ-R-12041",
    email: "ta4081@sfjbs.com",
    firstName: "Menka",
    lastName: "Rani",
    roleId: roleRecruiter.id,
    buId: buB2G.id,
    phone: "7013690000",
  });
  const uShaikMA = await mkUser({
    empId: "bS-R-21984",
    email: "ta7138@sfjbs.com",
    firstName: "Shaik",
    lastName: "Mohammed Aqeeb",
    roleId: roleRecruiter.id,
    buId: buB2G.id,
    phone: "9502679000",
  });
  const uVarsha = await mkUser({
    empId: "SFJ-R-11876",
    email: "oe@sfjbs.com",
    firstName: "Varsha",
    lastName: "R",
    roleId: roleRecruiter.id,
    buId: buB2G.id,
    phone: "7259645000",
  });
  const uVyshnavi = await mkUser({
    empId: "bS-R-21789",
    email: "ta7072@sfjbs.com",
    firstName: "Vyshnavi",
    lastName: "A S",
    roleId: roleRecruiter.id,
    buId: buB2G.id,
    phone: "9663488000",
  });
  const uAnanyaAR = await mkUser({
    empId: "bS-R-22053",
    email: "ins04@bskilling.com",
    firstName: "Ananya",
    lastName: "AR",
    roleId: roleSales.id,
    buId: buB2G.id,
    phone: "9353146000",
  });
  const uTamilS = await mkUser({
    empId: "bS-R-22058",
    email: "ta7128@sfjbs.com",
    firstName: "Tamil selvi",
    lastName: "Pasuvaraj",
    roleId: roleRecruiter.id,
    buId: buB2G.id,
    phone: "9345537000",
  });
  const uSushanta = await mkUser({
    empId: "SFJ-R-11932",
    email: "am242@sfjbs.com",
    firstName: "Sushanta",
    lastName: "Chakraborty",
    roleId: roleSalesLead.id,
    buId: buB2G.id,
    phone: "7846871000",
  });
  const uSwaraj = await mkUser({
    empId: "bS-R-22042",
    email: "sea06@sfjbs.com",
    firstName: "Swaraj",
    lastName: "Kumar Routray",
    roleId: roleSales.id,
    buId: buB2G.id,
    phone: "7873226000",
  });
  const uShylaja = await mkUser({
    empId: "SFJ-R-11634",
    email: "ta7181@sfjbs.com",
    firstName: "Shylaja",
    lastName: "Pragash",
    roleId: roleDeliveryManager.id,
    buId: buB2G.id,
    phone: "9600207000",
  });
  const uStephen = await mkUser({
    empId: "bS-R-21741",
    email: "ta7165@sfjbs.com",
    firstName: "Stephen",
    lastName: "Raj C",
    roleId: roleRecruiter.id,
    buId: buB2G.id,
    phone: "7411452000",
  });
  const uNulu = await mkUser({
    empId: "SFJ-NULU-001",
    email: "nulu.sankaramma@sfjbs.com",
    firstName: "Nulu",
    lastName: "Sankaramma",
    roleId: roleHR.id,
    buId: buB2G.id,
  });

  // ── Wire reportingToId ────────────────────────────────────────────────────
  console.log("  ✓ 73 users created\n▶ Wiring reporting lines...");

  const wireReport = async (userId: string, managerId: string) =>
    prisma.user.update({
      where: { id: userId },
      data: { reportingToId: managerId },
    });

  // Reports to Siva Sarathy (CEO)
  await wireReport(uRakhi.id, userSiva.id);
  await wireReport(uYatin.id, userSiva.id);
  await wireReport(uYesvanth.id, userSiva.id);
  await wireReport(uSaijal.id, userSiva.id);
  await wireReport(uJoanna.id, userSiva.id);
  await wireReport(uMadhavi.id, userSiva.id);

  // Reports to Rakhi Sen
  await wireReport(uAjay.id, uRakhi.id);
  await wireReport(uAkash.id, uRakhi.id);
  await wireReport(uManishaJK.id, uRakhi.id);
  await wireReport(uRitu.id, uRakhi.id);
  await wireReport(uSoma.id, uRakhi.id);
  await wireReport(uLikhitha.id, uRakhi.id);
  await wireReport(uSarala.id, uRakhi.id);
  await wireReport(uAnanyaAR.id, uRakhi.id);
  await wireReport(uTamilS.id, uRakhi.id);
  await wireReport(uShylaja.id, uRakhi.id);

  // Reports to Saijal (Delivery Manager KaaS)
  await wireReport(uKarthDM.id, uSaijal.id);

  // Reports to Karthikeyan Ganeshan
  await wireReport(uAbhilash.id, uKarthDM.id);
  await wireReport(uMunaff.id, uKarthDM.id);
  await wireReport(uPrakash.id, uKarthDM.id);
  await wireReport(uRaviPT.id, uKarthDM.id);
  await wireReport(uSibbala.id, uKarthDM.id);
  await wireReport(uTejash.id, uKarthDM.id);

  // Reports to Likhitha R
  await wireReport(uLathika.id, uLikhitha.id);
  await wireReport(uMPooja.id, uLikhitha.id);
  await wireReport(uNeha.id, uLikhitha.id);
  await wireReport(uPriyanka.id, uLikhitha.id);
  await wireReport(uSavithri.id, uLikhitha.id);
  await wireReport(uSowndhary.id, uLikhitha.id);
  await wireReport(uVadlamudi.id, uLikhitha.id);

  // Reports to G M Sarala
  await wireReport(uGeethika.id, uSarala.id);
  await wireReport(uRamLaksh.id, uSarala.id);
  await wireReport(uSamiksh.id, uSarala.id);

  // Reports to Madhavi Sengar
  await wireReport(uRoja.id, uMadhavi.id);
  await wireReport(uAnshita.id, uMadhavi.id);
  await wireReport(uMuskanJ.id, uMadhavi.id);
  await wireReport(uAnuj.id, uMadhavi.id);
  await wireReport(uManish.id, uMadhavi.id);

  // Reports to Roja Chennacetty
  await wireReport(uVarna.id, uRoja.id);
  await wireReport(uAkkala.id, uRoja.id);
  await wireReport(uBhushan.id, uRoja.id);
  await wireReport(uMeenaksh.id, uRoja.id);
  await wireReport(uDJamuna.id, uRoja.id);
  await wireReport(uDanam.id, uRoja.id);
  await wireReport(uJyothi.id, uRoja.id);
  await wireReport(uLatha.id, uRoja.id);
  await wireReport(uPavan.id, uRoja.id);

  // Reports to Yesvanth Kumar
  await wireReport(uDeivan.id, uYesvanth.id);
  await wireReport(uAishw.id, uYesvanth.id);
  await wireReport(uHemalD.id, uYesvanth.id);
  await wireReport(uKoduru.id, uYesvanth.id);
  await wireReport(uPayal.id, uYesvanth.id);
  await wireReport(uRajat.id, uYesvanth.id);
  await wireReport(uSangeetha.id, uYesvanth.id);
  await wireReport(uSubhasmi.id, uYesvanth.id);
  await wireReport(uSubhasre.id, uYesvanth.id);
  await wireReport(uVasanth.id, uYesvanth.id);
  await wireReport(uVemula.id, uYesvanth.id);

  // Reports to Yatin Anand
  await wireReport(uSyedS.id, uYatin.id);

  // Reports to Joanna Josh
  await wireReport(uDhanesh.id, uJoanna.id);
  await wireReport(uHemaKB.id, uJoanna.id);
  await wireReport(uMenka.id, uNulu.id);
  await wireReport(uVarsha.id, uNulu.id);
  await wireReport(uShaikMA.id, uMadhavi.id);
  await wireReport(uVyshnavi.id, uMadhavi.id);

  // Reports to Ritu / Soma (sub-CSMs)
  await wireReport(uArockiya.id, uRitu.id);
  await wireReport(uKarthK.id, uSoma.id);
  await wireReport(uRadha.id, uSoma.id);

  // B2G
  await wireReport(uSushanta.id, uRakhi.id);
  await wireReport(uSwaraj.id, uSushanta.id);
  await wireReport(uStephen.id, uShylaja.id);

  console.log("  ✓ Reporting lines wired\n");

  // ─────────────────────────────────────────────────────────────────────────
  // TEAM MEMBERS
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding team memberships...");

  const mkMember = async (
    userId: string,
    teamId: string,
    teamRole: "LEAD" | "CO_LEAD" | "MEMBER" = "MEMBER"
  ) => {
    const existing = await prisma.teamMember.findUnique({
      where: { userId_teamId: { userId, teamId } },
    });
    if (existing) return existing;
    return prisma.teamMember.create({
      data: { userId, teamId, teamRole, isActive: true },
    });
  };

  // KaaS Sales
  await mkMember(uRakhi.id, teamKaaSales.id, "LEAD");
  await mkMember(uYatin.id, teamKaaSales.id, "LEAD");
  await mkMember(uSaijal.id, teamKaaSales.id, "CO_LEAD");
  for (const u of [
    uAjay,
    uAkash,
    uArockiya,
    uKarthK,
    uManishaJK,
    uRadha,
    uRitu,
    uSoma,
    uSyedS,
  ])
    await mkMember(u.id, teamKaaSales.id);

  // KaaS Delivery Karthik
  await mkMember(uSaijal.id, teamKaaDelvKart.id, "LEAD");
  await mkMember(uKarthDM.id, teamKaaDelvKart.id, "CO_LEAD");
  for (const u of [uAbhilash, uMunaff, uPrakash, uRaviPT, uSibbala, uTejash])
    await mkMember(u.id, teamKaaDelvKart.id);

  // KaaS Delivery Likitha
  await mkMember(uLikhitha.id, teamKaaDelvLiki.id, "LEAD");
  for (const u of [
    uLathika,
    uMPooja,
    uNeha,
    uPriyanka,
    uSavithri,
    uSowndhary,
    uVadlamudi,
  ])
    await mkMember(u.id, teamKaaDelvLiki.id);

  // KaaS Delivery Sarala
  await mkMember(uSarala.id, teamKaaDelvSara.id, "LEAD");
  for (const u of [uGeethika, uRamLaksh, uSamiksh])
    await mkMember(u.id, teamKaaDelvSara.id);

  // KaaS IMS
  for (const u of [uBhoomika, uMuskanIMS]) await mkMember(u.id, teamKaaSIMS.id);

  // TaaS Roja
  await mkMember(uRoja.id, teamTaaSRoja.id, "LEAD");
  await mkMember(uVarna.id, teamTaaSRoja.id, "CO_LEAD");
  for (const u of [
    uAkkala,
    uBhushan,
    uMeenaksh,
    uDJamuna,
    uDanam,
    uJyothi,
    uLatha,
    uPavan,
  ])
    await mkMember(u.id, teamTaaSRoja.id);

  // TaaS Yesvanth
  await mkMember(uYesvanth.id, teamTaaSYesv.id, "LEAD");
  await mkMember(uDeivan.id, teamTaaSYesv.id, "CO_LEAD");
  for (const u of [
    uAishw,
    uHemalD,
    uKoduru,
    uPayal,
    uRajat,
    uSangeetha,
    uSubhasmi,
    uSubhasre,
    uVasanth,
    uVemula,
  ])
    await mkMember(u.id, teamTaaSYesv.id);

  // CSR
  await mkMember(uMadhavi.id, teamCSR.id, "LEAD");
  await mkMember(uAnshita.id, teamCSR.id);
  await mkMember(uMuskanJ.id, teamCSR.id);
  await mkMember(uMadhavi.id, teamCSRCluster1.id, "LEAD");
  await mkMember(uAnuj.id, teamCSRCluster3.id);
  await mkMember(uManish.id, teamCSRCluster3.id);

  // B2G
  await mkMember(uJoanna.id, teamB2GHiring.id, "LEAD");
  await mkMember(uMadhavi.id, teamB2GHiring.id, "CO_LEAD");
  for (const u of [uDhanesh, uHemaKB, uMenka, uShaikMA, uVarsha, uVyshnavi])
    await mkMember(u.id, teamB2GHiring.id);

  await mkMember(uAnanyaAR.id, teamB2GCluster1.id);
  await mkMember(uTamilS.id, teamB2GCluster1.id);

  await mkMember(uSushanta.id, teamB2GCluster4.id, "LEAD");
  await mkMember(uSwaraj.id, teamB2GCluster4.id);

  await mkMember(uShylaja.id, teamB2GShylaja.id, "LEAD");
  await mkMember(uStephen.id, teamB2GShylaja.id);

  console.log("  ✓ All team memberships seeded\n");

  // ─────────────────────────────────────────────────────────────────────────
  // TEAM EDGES
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding team edges...");

  const mkEdge = async (
    parentId: string,
    childId: string,
    edgeType: "ASSIGNS_TO" | "REPORTS_TO" | "VISIBILITY"
  ) => {
    const existing = await prisma.teamEdge.findUnique({
      where: { parentId_childId_edgeType: { parentId, childId, edgeType } },
    });
    if (existing) return existing;
    return prisma.teamEdge.create({
      data: { parentId, childId, edgeType, isActive: true },
    });
  };

  // ASSIGNS_TO — canvas hierarchy
  await mkEdge(teamKaaSales.id, teamKaaDelvKart.id, "ASSIGNS_TO");
  await mkEdge(teamKaaSales.id, teamKaaDelvLiki.id, "ASSIGNS_TO");
  await mkEdge(teamKaaSales.id, teamKaaDelvSara.id, "ASSIGNS_TO");
  await mkEdge(teamB2GHiring.id, teamTaaSRoja.id, "ASSIGNS_TO");
  await mkEdge(teamB2GHiring.id, teamTaaSYesv.id, "ASSIGNS_TO");
  await mkEdge(teamB2GHiring.id, teamB2GCluster1.id, "ASSIGNS_TO");
  await mkEdge(teamB2GHiring.id, teamB2GCluster4.id, "ASSIGNS_TO");
  await mkEdge(teamB2GHiring.id, teamB2GShylaja.id, "ASSIGNS_TO");

  // REPORTS_TO — org line
  await mkEdge(teamKaaSales.id, teamKaaDelvKart.id, "REPORTS_TO");
  await mkEdge(teamKaaSales.id, teamKaaDelvLiki.id, "REPORTS_TO");
  await mkEdge(teamKaaSales.id, teamKaaDelvSara.id, "REPORTS_TO");
  await mkEdge(teamCSR.id, teamCSRCluster1.id, "REPORTS_TO");
  await mkEdge(teamCSR.id, teamCSRCluster3.id, "REPORTS_TO");

  console.log("  ✓ Team edges seeded\n");

  // ─────────────────────────────────────────────────────────────────────────
  // CLIENTS (5 clients, handlers + contacts from sales people only)
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding clients...");

  const mkClient = async (data: {
    name: string;
    vmsName?: string;
    category: string;
    industry: string;
    website?: string;
    country: string;
    city?: string;
    buId: string;
    createdById: string;
    approvedById: string;
    primaryHandlerId: string;
    secondaryHandlerId?: string;
    contacts: {
      firstName: string;
      lastName: string;
      designation: string;
      email: string;
      phone?: string;
      isPrimary: boolean;
      ownerId: string;
    }[];
  }) => {
    const existing = await prisma.client.findFirst({
      where: { name: data.name },
    });
    if (existing) {
      console.log(`    → ${data.name} already exists, skipping`);
      return existing;
    }
    const client = await prisma.client.create({
      data: {
        name: data.name,
        vmsName: data.vmsName,
        category: data.category as any,
        industry: data.industry,
        website: data.website,
        country: data.country,
        city: data.city,
        status: "ACTIVE",
        businessUnitId: data.buId,
        createdById: data.createdById,
        approvedById: data.approvedById,
        approvedAt: now,
      },
    });

    // Handlers
    await prisma.clientHandler.create({
      data: {
        clientId: client.id,
        userId: data.primaryHandlerId,
        role: "PRIMARY",
        status: "ACTIVE",
        assignedById: userSiva.id,
      },
    });
    if (data.secondaryHandlerId) {
      await prisma.clientHandler.create({
        data: {
          clientId: client.id,
          userId: data.secondaryHandlerId,
          role: "SECONDARY",
          status: "ACTIVE",
          assignedById: userSiva.id,
        },
      });
    }

    // Contacts
    for (const c of data.contacts) {
      await prisma.clientContact.create({
        data: {
          clientId: client.id,
          firstName: c.firstName,
          lastName: c.lastName,
          designation: c.designation,
          email: c.email,
          phone: c.phone,
          isPrimary: c.isPrimary,
          status: "ACTIVE",
          ownerId: c.ownerId,
        },
      });
    }

    return client;
  };

  const clientCapgemini = await mkClient({
    name: "Capgemini",
    vmsName: "CAP-VMS",
    category: "STAFFING",
    industry: "IT Services",
    website: "https://capgemini.com",
    country: "India",
    city: "Bangalore",
    buId: buEnterprise.id,
    createdById: uRoja.id,
    approvedById: userSiva.id,
    primaryHandlerId: uRoja.id,
    secondaryHandlerId: uAjay.id,
    contacts: [
      {
        firstName: "Ramesh",
        lastName: "Iyer",
        designation: "Talent Acquisition Lead",
        email: "ramesh.iyer@capgemini.com",
        phone: "9800000001",
        isPrimary: true,
        ownerId: uRoja.id,
      },
      {
        firstName: "Preethi",
        lastName: "Nair",
        designation: "HR Business Partner",
        email: "preethi.nair@capgemini.com",
        phone: "9800000002",
        isPrimary: false,
        ownerId: uAjay.id,
      },
    ],
  });

  const clientCognizant = await mkClient({
    name: "Cognizant (CTS)",
    vmsName: "CTS-VMS",
    category: "SERVICE",
    industry: "IT Services",
    website: "https://cognizant.com",
    country: "India",
    city: "Chennai",
    buId: buEnterprise.id,
    createdById: uArockiya.id,
    approvedById: userSiva.id,
    primaryHandlerId: uArockiya.id,
    secondaryHandlerId: uRitu.id,
    contacts: [
      {
        firstName: "Kiran",
        lastName: "Babu",
        designation: "Sourcing Manager",
        email: "kiran.babu@cognizant.com",
        phone: "9800000003",
        isPrimary: true,
        ownerId: uArockiya.id,
      },
      {
        firstName: "Deepika",
        lastName: "Sharma",
        designation: "Vendor Manager",
        email: "deepika.sharma@cognizant.com",
        phone: "9800000004",
        isPrimary: false,
        ownerId: uRitu.id,
      },
    ],
  });

  const clientNM = await mkClient({
    name: "Naan Mudhalvan (NM)",
    vmsName: "NM-GOV",
    category: "GOVERNMENT",
    industry: "Education / Skilling",
    website: "https://naanmudhalvan.tn.gov.in",
    country: "India",
    city: "Chennai",
    buId: buB2G.id,
    createdById: uShylaja.id,
    approvedById: userSiva.id,
    primaryHandlerId: uShylaja.id,
    secondaryHandlerId: uSushanta.id,
    contacts: [
      {
        firstName: "Anand",
        lastName: "Raj",
        designation: "Programme Officer",
        email: "anand.raj@nm.tn.gov.in",
        phone: "9800000005",
        isPrimary: true,
        ownerId: uShylaja.id,
      },
    ],
  });

  const clientTCS = await mkClient({
    name: "Tata Consultancy Services",
    vmsName: "TCS-VMS",
    category: "SERVICE",
    industry: "IT Services",
    website: "https://tcs.com",
    country: "India",
    city: "Mumbai",
    buId: buEnterprise.id,
    createdById: uSoma.id,
    approvedById: userSiva.id,
    primaryHandlerId: uSoma.id,
    secondaryHandlerId: uManishaJK.id,
    contacts: [
      {
        firstName: "Vijay",
        lastName: "Menon",
        designation: "Delivery Head",
        email: "vijay.menon@tcs.com",
        phone: "9800000006",
        isPrimary: true,
        ownerId: uSoma.id,
      },
      {
        firstName: "Shalini",
        lastName: "Gupta",
        designation: "HR Manager",
        email: "shalini.gupta@tcs.com",
        phone: "9800000007",
        isPrimary: false,
        ownerId: uManishaJK.id,
      },
    ],
  });

  const clientNSSCDC = await mkClient({
    name: "NASSCOM SSC",
    vmsName: "NASSCOM-SSC",
    category: "NGO",
    industry: "Skilling / Tech",
    website: "https://nasscom.in",
    country: "India",
    city: "New Delhi",
    buId: buB2G.id,
    createdById: uSushanta.id,
    approvedById: userSiva.id,
    primaryHandlerId: uSushanta.id,
    contacts: [
      {
        firstName: "Meera",
        lastName: "Pillai",
        designation: "CSR Partnership Manager",
        email: "meera.pillai@nasscom.in",
        phone: "9800000008",
        isPrimary: true,
        ownerId: uSushanta.id,
      },
    ],
  });

  console.log("  ✓ 5 clients + handlers + contacts seeded\n");

  // ─────────────────────────────────────────────────────────────────────────
  // REQUIREMENTS (9 — 3 per major client, mixed statuses)
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding requirements...");

  const mkReq = async (opts: {
    code: string;
    title: string;
    clientId: string;
    buId: string;
    jobType: string;
    remoteType: string;
    priority: string;
    status: string;
    openings: number;
    salMin: number;
    salMax: number;
    expMin: number;
    expMax: number;
    location: string;
    createdById: string;
    approvedById?: string;
    teamId: string;
    recruiterId?: string;
  }) => {
    const existing = await prisma.requirement.findUnique({
      where: { reqCode: opts.code },
    });
    if (existing) return existing;

    const req = await prisma.requirement.create({
      data: {
        reqCode: opts.code,
        title: opts.title,
        clientId: opts.clientId,
        businessUnitId: opts.buId,
        jobType: opts.jobType as any,
        remoteType: opts.remoteType as any,
        priority: opts.priority as any,
        status: opts.status as any,
        totalOpenings: opts.openings,
        salaryMin: opts.salMin,
        salaryMax: opts.salMax,
        salaryType: "MONTHLY" as any,
        experienceMin: opts.expMin,
        experienceMax: opts.expMax,
        location: opts.location,
        country: "India",
        createdById: opts.createdById,
        approvedById: opts.approvedById,
        approvedAt: opts.approvedById ? now : null,
        respondBy: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });

    // Team assignment
    await prisma.requirementAssignment.create({
      data: {
        requirementId: req.id,
        assignmentType: "TEAM" as any,
        status: "ACTIVE" as any,
        teamId: opts.teamId,
        assignedById: opts.createdById,
        assignedAt: now,
      },
    });

    // Recruiter assignment if provided
    if (opts.recruiterId) {
      const tm = await prisma.teamMember.findUnique({
        where: {
          userId_teamId: { userId: opts.recruiterId, teamId: opts.teamId },
        },
      });
      await prisma.requirementAssignment.create({
        data: {
          requirementId: req.id,
          assignmentType: "INDIVIDUAL" as any,
          status: "ACTIVE" as any,
          recruiterId: opts.recruiterId,
          teamMemberId: tm?.id,
          teamId: opts.teamId,
          assignedById: opts.createdById,
          assignedAt: now,
        },
      });
    }

    return req;
  };

  // Capgemini requirements
  await mkReq({
    code: "REQ-CAP-001",
    title: "Senior Java Developer",
    clientId: clientCapgemini.id,
    buId: buEnterprise.id,
    jobType: "CONTRACT",
    remoteType: "HYBRID",
    priority: "HIGH",
    status: "ACTIVE",
    openings: 3,
    salMin: 120000,
    salMax: 160000,
    expMin: 5,
    expMax: 10,
    location: "Bangalore",
    createdById: uRoja.id,
    approvedById: userSiva.id,
    teamId: teamTaaSRoja.id,
    recruiterId: uLatha.id,
  });
  await mkReq({
    code: "REQ-CAP-002",
    title: "DevOps Engineer (Contract)",
    clientId: clientCapgemini.id,
    buId: buEnterprise.id,
    jobType: "CONTRACT",
    remoteType: "REMOTE",
    priority: "HIGH",
    status: "PENDING_APPROVAL",
    openings: 2,
    salMin: 100000,
    salMax: 140000,
    expMin: 3,
    expMax: 7,
    location: "Hyderabad",
    createdById: uVarna.id,
    teamId: teamTaaSYesv.id,
    recruiterId: uDeivan.id,
  });
  await mkReq({
    code: "REQ-CAP-003",
    title: "Python Data Analyst",
    clientId: clientCapgemini.id,
    buId: buEnterprise.id,
    jobType: "PERMANENT",
    remoteType: "ONSITE",
    priority: "MEDIUM",
    status: "DRAFT",
    openings: 1,
    salMin: 80000,
    salMax: 110000,
    expMin: 2,
    expMax: 5,
    location: "Bangalore",
    createdById: uAjay.id,
    teamId: teamKaaDelvKart.id,
  });

  // CTS requirements
  await mkReq({
    code: "REQ-CTS-001",
    title: "Sr. React Developer",
    clientId: clientCognizant.id,
    buId: buEnterprise.id,
    jobType: "PERMANENT",
    remoteType: "HYBRID",
    priority: "HIGH",
    status: "ACTIVE",
    openings: 2,
    salMin: 90000,
    salMax: 130000,
    expMin: 4,
    expMax: 8,
    location: "Chennai",
    createdById: uLikhitha.id,
    approvedById: uRakhi.id,
    teamId: teamKaaDelvLiki.id,
    recruiterId: uLikhitha.id,
  });
  await mkReq({
    code: "REQ-CTS-002",
    title: "SAP FICO Consultant",
    clientId: clientCognizant.id,
    buId: buEnterprise.id,
    jobType: "CONTRACT",
    remoteType: "ONSITE",
    priority: "MEDIUM",
    status: "PENDING_APPROVAL",
    openings: 1,
    salMin: 130000,
    salMax: 180000,
    expMin: 6,
    expMax: 12,
    location: "Mumbai",
    createdById: uSarala.id,
    teamId: teamKaaDelvSara.id,
    recruiterId: uSarala.id,
  });
  await mkReq({
    code: "REQ-CTS-003",
    title: "QA Automation Lead",
    clientId: clientCognizant.id,
    buId: buEnterprise.id,
    jobType: "PERMANENT",
    remoteType: "REMOTE",
    priority: "LOW",
    status: "DRAFT",
    openings: 1,
    salMin: 85000,
    salMax: 120000,
    expMin: 4,
    expMax: 8,
    location: "Bangalore",
    createdById: uArockiya.id,
    teamId: teamKaaDelvKart.id,
  });

  // NM requirements
  await mkReq({
    code: "REQ-NM-001",
    title: "AWS Cloud Trainer",
    clientId: clientNM.id,
    buId: buB2G.id,
    jobType: "CONTRACT",
    remoteType: "ONSITE",
    priority: "HIGH",
    status: "ACTIVE",
    openings: 4,
    salMin: 60000,
    salMax: 80000,
    expMin: 2,
    expMax: 5,
    location: "Chennai",
    createdById: uShylaja.id,
    approvedById: uRakhi.id,
    teamId: teamB2GShylaja.id,
    recruiterId: uStephen.id,
  });
  await mkReq({
    code: "REQ-NM-002",
    title: "Cybersecurity Trainer Batch",
    clientId: clientNM.id,
    buId: buB2G.id,
    jobType: "CONTRACT",
    remoteType: "ONSITE",
    priority: "HIGH",
    status: "ACTIVE",
    openings: 2,
    salMin: 55000,
    salMax: 75000,
    expMin: 2,
    expMax: 4,
    location: "Coimbatore",
    createdById: uAnanyaAR.id,
    approvedById: uRakhi.id,
    teamId: teamB2GCluster1.id,
    recruiterId: uAnanyaAR.id,
  });
  await mkReq({
    code: "REQ-NM-003",
    title: "University Skilling Program",
    clientId: clientNM.id,
    buId: buB2I.id,
    jobType: "CONTRACT",
    remoteType: "ONSITE",
    priority: "MEDIUM",
    status: "DRAFT",
    openings: 5,
    salMin: 40000,
    salMax: 60000,
    expMin: 1,
    expMax: 3,
    location: "Tamil Nadu",
    createdById: uSushanta.id,
    teamId: teamB2GCluster4.id,
  });

  console.log("  ✓ 9 requirements + assignments seeded\n");

  // ─────────────────────────────────────────────────────────────────────────
  // PRINT CREDENTIALS
  // ─────────────────────────────────────────────────────────────────────────
  console.log(
    "╔══════════════════════════════════════════════════════════════════╗"
  );
  console.log(
    "║                     SEED CREDENTIALS                            ║"
  );
  console.log(
    "╠══════════════════════════════════════════════════════════════════╣"
  );
  console.log(
    "║  SUPER ADMIN                                                     ║"
  );
  console.log(
    "║  Email    : siva.sarathy@sfjbs.com                               ║"
  );
  console.log(
    "║  Password : admin@123                                            ║"
  );
  console.log(
    "╠══════════════════════════════════════════════════════════════════╣"
  );
  console.log(
    "║  ALL OTHER USERS — default password                              ║"
  );
  console.log(
    "║  Password : pass@123                                             ║"
  );
  console.log(
    "╠══════════════════════════════════════════════════════════════════╣"
  );
  console.log(
    "║  SAMPLE LOGINS                                                   ║"
  );
  console.log(
    "║  Sales Lead   : rakhi.d@sfjbs.com       / pass@123              ║"
  );
  console.log(
    "║  Sales Lead   : yesvanth@sfjbs.com      / pass@123              ║"
  );
  console.log(
    "║  Delivery Mgr : saijal.s@sfjbs.com      / pass@123              ║"
  );
  console.log(
    "║  Delivery Mgr : ta104@sfjbs.com         / pass@123  (Roja)      ║"
  );
  console.log(
    "║  Delivery TL  : ta7009@sfjbs.com        / pass@123  (Likhitha)  ║"
  );
  console.log(
    "║  Recruiter    : ta123@sfjbs.com         / pass@123  (Karthik)   ║"
  );
  console.log(
    "║  HR Lead      : hr@sfjbs.com            / pass@123  (Madhavi)   ║"
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════════╝"
  );
  console.log("\n✅ Seed complete!\n");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
