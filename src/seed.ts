import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const hash = (p: string) => bcrypt.hashSync(p, 10);
const now = new Date();

async function main() {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║           SFJ Seed Starting              ║");
  console.log("╚══════════════════════════════════════════╝\n");

  // ───────────────────────────────────────────────────────────────────────
  // ROLES
  // ───────────────────────────────────────────────────────────────────────
  console.log("▶ Roles...");

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

  console.log("  ✓ 6 roles\n");

  // ───────────────────────────────────────────────────────────────────────
  // BUSINESS UNITS
  // Structure:
  //   Enterprise (B2B)   B2G   B2I   ← all 3 are ROOT BUs (parentBUId: null)
  //
  // KaaS / TaaS / CSR are NOT BUs — they are service lines expressed
  // as TeamArcs scoped to whichever BU they operate under.
  // ───────────────────────────────────────────────────────────────────────
  console.log("▶ Business Units...");

  const buEnterprise = await prisma.businessUnit.upsert({
    where: { name: "Enterprise" },
    update: {},
    create: { name: "Enterprise", isActive: true },
  });
  const buB2G = await prisma.businessUnit.upsert({
    where: { name: "B2G" },
    update: {},
    create: { name: "B2G", isActive: true },
  });
  const buB2I = await prisma.businessUnit.upsert({
    where: { name: "B2I" },
    update: {},
    create: { name: "B2I", isActive: true },
  });

  console.log(
    "  ✓ Enterprise (root) · B2G (root) · B2I (root) — all independent BUs\n"
  );

  // ───────────────────────────────────────────────────────────────────────
  // SUPER ADMIN — Siva Sarathy
  // ───────────────────────────────────────────────────────────────────────
  console.log("▶ Super Admin...");

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

  console.log("  ✓ siva.sarathy@sfjbs.com / admin@123\n");

  // ───────────────────────────────────────────────────────────────────────
  // TEAM ARCS
  // Each service line BU owns its Arc.
  // B2G BU owns B2G Arc.
  // ───────────────────────────────────────────────────────────────────────
  console.log("▶ Team Arcs...");

  // KaaS, TaaS, CSR arcs all live under Enterprise (B2B)
  // B2G Arc lives under B2G BU
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

  console.log(
    "  ✓ KaaS Arc · TaaS Arc · CSR Arc (Enterprise BU) · B2G Arc (B2G BU)\n"
  );

  // ───────────────────────────────────────────────────────────────────────
  // TEAMS
  // ───────────────────────────────────────────────────────────────────────
  console.log("▶ Teams...");

  const mkTeam = async (
    id: string,
    name: string,
    arcId: string,
    buId: string,
    category: string
  ) =>
    prisma.team.upsert({
      where: { id },
      update: {},
      create: {
        id,
        name,
        teamArcId: arcId,
        businessUnitId: buId,
        category: category as any,
        nodeType: "GROUP",
        isActive: true,
      },
    });

  // KaaS Arc teams (buKaaS)
  const tKaaSales = await mkTeam(
    "t-kaas-sales",
    "KaaS Sales",
    arcKaaS.id,
    buEnterprise.id,
    "SALES"
  );
  const tKaasKarthik = await mkTeam(
    "t-kaas-karthik",
    "KaaS_Delivery_Karthik",
    arcKaaS.id,
    buEnterprise.id,
    "DELIVERY"
  );
  const tKaasLikitha = await mkTeam(
    "t-kaas-likitha",
    "KaaS_Delivery_Likitha",
    arcKaaS.id,
    buEnterprise.id,
    "DELIVERY"
  );
  const tKaasSarala = await mkTeam(
    "t-kaas-sarala",
    "KaaS_Delivery_Sarala",
    arcKaaS.id,
    buEnterprise.id,
    "DELIVERY"
  );
  const tKaasIMS = await mkTeam(
    "t-kaas-ims",
    "KaaS_IMS",
    arcKaaS.id,
    buEnterprise.id,
    "SUPPORT"
  );

  // TaaS Arc teams (buTaaS)
  const tTaasRoja = await mkTeam(
    "t-taas-roja",
    "TaaS_Delivery_Roja",
    arcTaaS.id,
    buEnterprise.id,
    "DELIVERY"
  );
  const tTaasYesv = await mkTeam(
    "t-taas-yesvanth",
    "TaaS_Yesvanth",
    arcTaaS.id,
    buEnterprise.id,
    "DELIVERY"
  );

  // CSR Arc teams (buCSR)
  const tCSR = await mkTeam(
    "t-csr",
    "CSR",
    arcCSR.id,
    buEnterprise.id,
    "SUPPORT"
  );
  const tCSRCluster1 = await mkTeam(
    "t-csr-c1",
    "CSR_Cluster1",
    arcCSR.id,
    buEnterprise.id,
    "SUPPORT"
  );
  const tCSRCluster3 = await mkTeam(
    "t-csr-c3",
    "CSR_Cluster3",
    arcCSR.id,
    buEnterprise.id,
    "SUPPORT"
  );

  // B2G Arc teams (buB2G)
  const tB2GHiring = await mkTeam(
    "t-b2g-hiring",
    "B2G & B2I_Internal Hiring",
    arcB2G.id,
    buB2G.id,
    "DELIVERY"
  );
  const tB2GCluster1 = await mkTeam(
    "t-b2g-c1",
    "B2G_Cluster 1",
    arcB2G.id,
    buB2G.id,
    "DELIVERY"
  );
  const tB2GCluster4 = await mkTeam(
    "t-b2g-c4",
    "B2G_Cluster 4",
    arcB2G.id,
    buB2G.id,
    "DELIVERY"
  );
  const tB2GShylaja = await mkTeam(
    "t-b2g-shylaja",
    "B2G_Delivery_Shylaja",
    arcB2G.id,
    buB2G.id,
    "DELIVERY"
  );

  console.log("  ✓ 14 teams across 4 arcs\n");

  // ───────────────────────────────────────────────────────────────────────
  // USERS
  // ───────────────────────────────────────────────────────────────────────
  console.log("▶ Users (73 employees)...");

  const P = hash("pass@123");

  const u = async (
    empId: string,
    email: string,
    fn: string,
    ln: string,
    roleId: string,
    buId: string,
    phone?: string
  ) =>
    prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        passwordHash: P,
        firstName: fn,
        lastName: ln,
        employeeId: empId,
        phone,
        isActive: true,
        roleId,
        businessUnitId: buId,
        createdById: userSiva.id,
      },
    });

  // ── KaaS Sales ──────────────────────────────────────────────────────────
  const uRakhi = await u(
    "SFJ-R-9439",
    "rakhi.d@sfjbs.com",
    "Rakhi",
    "Sen",
    roleSalesLead.id,
    buEnterprise.id,
    "9972509000"
  );
  const uYatin = await u(
    "SFJ-R-9839",
    "anand.y@sfjbs.com",
    "Yatin",
    "Anand",
    roleSalesLead.id,
    buEnterprise.id,
    "7838823000"
  );
  const uAjay = await u(
    "SFJ-R-11794",
    "csm23@sfjbs.com",
    "Ajay",
    "D",
    roleSales.id,
    buEnterprise.id,
    "9148529000"
  );
  const uAkash = await u(
    "bS-R-21970",
    "impact01@bskilling.com",
    "Akash",
    "J",
    roleSales.id,
    buEnterprise.id,
    "8113051000"
  );
  const uArockiya = await u(
    "bS-R-21979",
    "ta7116@sfjbs.com",
    "Arockiya",
    "Nirmal Zacharias",
    roleSales.id,
    buEnterprise.id,
    "6382299000"
  );
  const uKarthK = await u(
    "bS-R-21980",
    "ta7119@sfjbs.com",
    "Karthikeyan",
    "K",
    roleSales.id,
    buEnterprise.id,
    "7639590000"
  );
  const uManishaJK = await u(
    "SFJ-R-11201",
    "csm04@sfjbs.com",
    "Manisha",
    "J Kumar",
    roleSales.id,
    buEnterprise.id,
    "6281688000"
  );
  const uRadha = await u(
    "bS-R-21971",
    "impact02@bskilling.com",
    "Radha",
    "A",
    roleSales.id,
    buEnterprise.id,
    "9080205000"
  );
  const uRitu = await u(
    "SFJ-R-11526",
    "ta221@sfjbs.com",
    "Ritu",
    "Seharawat",
    roleSales.id,
    buEnterprise.id,
    "9902201000"
  );
  const uSoma = await u(
    "SFJ-R-11890",
    "csm19@sfjbs.com",
    "Somashekar",
    "P M",
    roleSales.id,
    buEnterprise.id,
    "9342768000"
  );
  const uSyedS = await u(
    "bS-R-21931",
    "ta7180@sfjbs.com",
    "Syed",
    "Sameer",
    roleSales.id,
    buEnterprise.id,
    "7673963000"
  );

  // ── KaaS Delivery Karthik ────────────────────────────────────────────────
  const uSaijal = await u(
    "SFJ-R-9323",
    "saijal.s@sfjbs.com",
    "Saijal",
    "S",
    roleDeliveryManager.id,
    buEnterprise.id,
    "7950827000"
  );
  const uKarthDM = await u(
    "SFJ-R-9771",
    "ta123@sfjbs.com",
    "Karthikeyan",
    "Ganeshan",
    roleDeliveryManager.id,
    buEnterprise.id,
    "8884050000"
  );
  const uAbhilash = await u(
    "SFJ-R-11909",
    "ta7159@sfjbs.com",
    "Abhilash",
    "V S",
    roleRecruiter.id,
    buEnterprise.id,
    "7012913000"
  );
  const uMunaff = await u(
    "SFJ-R-11434",
    "ta7142@sfjbs.com",
    "Mohammed",
    "Munaff",
    roleRecruiter.id,
    buEnterprise.id,
    "8884252000"
  );
  const uPrakash = await u(
    "SFJ-R-12027",
    "ta7166@sfjbs.com",
    "Prakashkumar",
    "M",
    roleRecruiter.id,
    buEnterprise.id,
    "7904210000"
  );
  const uRaviPT = await u(
    "bS-R-21905",
    "ta7133@sfjbs.com",
    "Ravi",
    "Prakash Tiwari",
    roleRecruiter.id,
    buEnterprise.id,
    "9990611000"
  );
  const uSibbala = await u(
    "SFJ-R-11495",
    "ta4186@sfjbs.com",
    "Sibbala",
    "Ravi Sankar",
    roleRecruiter.id,
    buEnterprise.id,
    "8885314000"
  );
  const uTejash = await u(
    "SFJ-R-11899",
    "ta7132@sfjbs.com",
    "Tejashwini",
    "M",
    roleRecruiter.id,
    buEnterprise.id,
    "9108382000"
  );

  // ── KaaS Delivery Likitha ────────────────────────────────────────────────
  const uLikhitha = await u(
    "SFJ-R-11132",
    "ta7009@sfjbs.com",
    "Likhitha",
    "R",
    roleDeliveryManager.id,
    buEnterprise.id,
    "9980496000"
  );
  const uLathika = await u(
    "SFJ-R-12009",
    "ta7002@sfjbs.com",
    "Lathika",
    "Devi S",
    roleRecruiter.id,
    buEnterprise.id,
    "9940027000"
  );
  const uMPooja = await u(
    "SFJ-R-11305",
    "ta7102@sfjbs.com",
    "M",
    "Pooja",
    roleRecruiter.id,
    buEnterprise.id,
    "9632795000"
  );
  const uNeha = await u(
    "bS-R-22040",
    "ta7170@sfjbs.com",
    "Neha",
    "Pandey",
    roleRecruiter.id,
    buEnterprise.id,
    "9579013000"
  );
  const uPriyanka = await u(
    "bS-R-22016",
    "ta7172@sfjbs.com",
    "Priyanka",
    "Singh",
    roleRecruiter.id,
    buEnterprise.id,
    "8709507000"
  );
  const uSavithri = await u(
    "SFJ-R-11931",
    "ta226@sfjbs.com",
    "Savithri",
    "K",
    roleRecruiter.id,
    buEnterprise.id,
    "9600063000"
  );
  const uSowndhary = await u(
    "bS-R-22043",
    "ta4170@sfjbs.com",
    "Sowndharya",
    "S",
    roleRecruiter.id,
    buEnterprise.id,
    "8056925000"
  );
  const uVadlamudi = await u(
    "bS-R-21967",
    "ta7169@sfjbs.com",
    "Vadlamudi",
    "Reddi Prasad",
    roleRecruiter.id,
    buEnterprise.id,
    "9703432000"
  );

  // ── KaaS Delivery Sarala ─────────────────────────────────────────────────
  const uSarala = await u(
    "SFJ-R-22064",
    "ta7069@sfjbs.com",
    "G M",
    "Sarala",
    roleDeliveryManager.id,
    buEnterprise.id,
    "8088623000"
  );
  const uGeethika = await u(
    "bS-R-22059",
    "ta7162@sfjbs.com",
    "Geethika",
    "Palanisamy",
    roleRecruiter.id,
    buEnterprise.id,
    "9361455000"
  );
  const uRamLaksh = await u(
    "bS-R-22049",
    "ta305@sfjbs.com",
    "Ramlakshmanan",
    "V",
    roleRecruiter.id,
    buEnterprise.id,
    "9629305000"
  );
  const uSamiksh = await u(
    "SFJ-R-12036",
    "ta4197@sfjbs.com",
    "Samikshya",
    "Sahu",
    roleRecruiter.id,
    buEnterprise.id,
    "6370171000"
  );

  // ── KaaS IMS ─────────────────────────────────────────────────────────────
  const uBhoomika = await u(
    "SFJ-R-10820",
    "ta7067@bskilling.com",
    "Bhoomika",
    "K",
    roleRecruiter.id,
    buEnterprise.id,
    "7892753000"
  );
  const uMuskanIMS = await u(
    "bS-R-21450",
    "ins24@bskilling.com",
    "Muskan",
    "IMS",
    roleRecruiter.id,
    buEnterprise.id,
    "7625054000"
  );

  // ── TaaS Delivery Roja ───────────────────────────────────────────────────
  const uMadhavi = await u(
    "SFJ-R-11170",
    "hr@sfjbs.com",
    "Madhavi",
    "Sengar",
    roleHR.id,
    buEnterprise.id,
    "7019912000"
  );
  const uRoja = await u(
    "SFJ-R-9628",
    "ta104@sfjbs.com",
    "Roja",
    "Chennacetty",
    roleDeliveryManager.id,
    buEnterprise.id,
    "7899725000"
  );
  const uVarna = await u(
    "SFJ-R-9564",
    "varnashree.m@sfjbs.com",
    "Varna",
    "shree M",
    roleDeliveryManager.id,
    buEnterprise.id,
    "9632694000"
  );
  const uAkkala = await u(
    "SFJ-R-22055",
    "ta4199@sfjbs.com",
    "Akkaladevi",
    "Bhagyasree",
    roleRecruiter.id,
    buEnterprise.id,
    "6303499000"
  );
  const uBhushan = await u(
    "bS-R-20525",
    "ta204@sfjbs.com",
    "Bhushana",
    "Tumati",
    roleRecruiter.id,
    buEnterprise.id,
    "8946035000"
  );
  const uMeenaksh = await u(
    "SFJ-R-11727",
    "ta4182@sfjbs.com",
    "C",
    "Meenakshi",
    roleRecruiter.id,
    buEnterprise.id,
    "8179395000"
  );
  const uDJamuna = await u(
    "bS-R-22061",
    "ta7121@sfjbs.com",
    "D",
    "Jamuna",
    roleRecruiter.id,
    buEnterprise.id,
    "7207841000"
  );
  const uDanam = await u(
    "SFJ-R-10876",
    "ta334@sfjbs.com",
    "Danam",
    "Purnachandra Rao",
    roleRecruiter.id,
    buEnterprise.id,
    "7093245000"
  );
  const uJyothi = await u(
    "SFJ-R-10862",
    "ta330@sfjbs.com",
    "Jyothi",
    "Jakkula",
    roleRecruiter.id,
    buEnterprise.id,
    "7842432000"
  );
  const uLatha = await u(
    "SFJ-R-9284",
    "latha.t@sfjbs.com",
    "Latha",
    "Tumati",
    roleRecruiter.id,
    buEnterprise.id,
    "8147087000"
  );
  const uPavan = await u(
    "bS-R-22035",
    "ta107@sfjbs.com",
    "Pavan",
    "Kumar Chetty",
    roleRecruiter.id,
    buEnterprise.id,
    "9618599000"
  );

  // ── TaaS Yesvanth ────────────────────────────────────────────────────────
  const uYesvanth = await u(
    "SFJ-R-10475",
    "yesvanth@sfjbs.com",
    "Yesvanth",
    "Kumar",
    roleSalesLead.id,
    buEnterprise.id,
    "9884102000"
  );
  const uDeivan = await u(
    "SFJ-R-10678",
    "cg_captive005@sfjbs.com",
    "Deivanai",
    "Subbiah",
    roleDeliveryManager.id,
    buEnterprise.id,
    "7904599000"
  );
  const uAishw = await u(
    "bS-R-22054",
    "cg_captive009@sfjbs.com",
    "Aishwarya",
    "TaaS",
    roleRecruiter.id,
    buEnterprise.id,
    "7906508000"
  );
  const uHemalD = await u(
    "bS-R-22056",
    "cg_captive065@sfjbs.com",
    "Hemalatha",
    "D",
    roleRecruiter.id,
    buEnterprise.id,
    "7022881000"
  );
  const uKoduru = await u(
    "bS-R-21919",
    "cg_captive039@sfjbs.com",
    "Koduru",
    "Chinni Ragavamma",
    roleRecruiter.id,
    buEnterprise.id,
    "9550308000"
  );
  const uPayal = await u(
    "bS-R-22006",
    "cg_captive067@sfjbs.com",
    "Payal",
    "Kumari",
    roleRecruiter.id,
    buEnterprise.id,
    "9608337000"
  );
  const uRajat = await u(
    "SFJ-R-11590",
    "ta7175@sfjbs.com",
    "Rajat",
    "TaaS",
    roleRecruiter.id,
    buEnterprise.id,
    "9663122000"
  );
  const uSangeetha = await u(
    "SFJ-R-10705",
    "cg_captive004@sfjbs.com",
    "Sangeethapriya",
    "Yuvarajan",
    roleRecruiter.id,
    buEnterprise.id,
    "8778100000"
  );
  const uSubhasmi = await u(
    "SFJ-R-9843",
    "cg_captive007@sfjbs.com",
    "Subhasmita",
    "Barik",
    roleRecruiter.id,
    buEnterprise.id,
    "8553943000"
  );
  const uSubhasre = await u(
    "SFJ-R-11062",
    "ta425@sfjbs.com",
    "Subhasree",
    "Patro",
    roleRecruiter.id,
    buEnterprise.id,
    "7978551000"
  );
  const uVasanth = await u(
    "bS-R-21745",
    "cg_captive006@sfjbs.com",
    "Vasanth",
    "P",
    roleRecruiter.id,
    buEnterprise.id,
    "9360007000"
  );
  const uVemula = await u(
    "bS-R-22057",
    "cg_captive063@sfjbs.com",
    "Vemula",
    "Charan",
    roleRecruiter.id,
    buEnterprise.id,
    "6301715000"
  );

  // ── CSR ──────────────────────────────────────────────────────────────────
  const uAnshita = await u(
    "bS-R-22046",
    "ta4016@sfjbs.com",
    "Anshita",
    "Mishra",
    roleRecruiter.id,
    buEnterprise.id,
    "7795049000"
  );
  const uMuskanJ = await u(
    "SFJ-R-12006",
    "csm25@sfjbs.com",
    "Muskan",
    "Jain",
    roleHR.id,
    buEnterprise.id,
    "9351908000"
  );
  const uAnuj = await u(
    "SFJ-R-12007",
    "csr02@sfjbs.com",
    "Anuj",
    "Jain",
    roleHR.id,
    buEnterprise.id,
    "9602711000"
  );
  const uManish = await u(
    "SFJ-R-11977",
    "csr03@sfjbs.com",
    "Manish",
    "Kumar",
    roleHR.id,
    buEnterprise.id,
    "9576459000"
  );

  // ── B2G ──────────────────────────────────────────────────────────────────
  const uJoanna = await u(
    "SFJ-R-11257",
    "xcpo@sfjbs.com",
    "Joanna",
    "Josh",
    roleHR.id,
    buB2G.id
  );
  const uDhanesh = await u(
    "bS-R-21898",
    "ta4082@sfjbs.com",
    "Dhanesh",
    "K",
    roleRecruiter.id,
    buB2G.id,
    "9495015000"
  );
  const uHemaKB = await u(
    "SFJ-R-11900",
    "ta4083@sfjbs.com",
    "Kalyanabailu",
    "Hemalatha",
    roleRecruiter.id,
    buB2G.id,
    "9110767000"
  );
  const uMenka = await u(
    "SFJ-R-12041",
    "ta4081@sfjbs.com",
    "Menka",
    "Rani",
    roleRecruiter.id,
    buB2G.id,
    "7013690000"
  );
  const uShaikMA = await u(
    "bS-R-21984",
    "ta7138@sfjbs.com",
    "Shaik",
    "Mohammed Aqeeb",
    roleRecruiter.id,
    buB2G.id,
    "9502679000"
  );
  const uVarsha = await u(
    "SFJ-R-11876",
    "oe@sfjbs.com",
    "Varsha",
    "R",
    roleRecruiter.id,
    buB2G.id,
    "7259645000"
  );
  const uVyshnavi = await u(
    "bS-R-21789",
    "ta7072@sfjbs.com",
    "Vyshnavi",
    "A S",
    roleRecruiter.id,
    buB2G.id,
    "9663488000"
  );
  const uAnanyaAR = await u(
    "bS-R-22053",
    "ins04@bskilling.com",
    "Ananya",
    "AR",
    roleSales.id,
    buB2G.id,
    "9353146000"
  );
  const uTamilS = await u(
    "bS-R-22058",
    "ta7128@sfjbs.com",
    "Tamil selvi",
    "Pasuvaraj",
    roleRecruiter.id,
    buB2G.id,
    "9345537000"
  );
  const uSushanta = await u(
    "SFJ-R-11932",
    "am242@sfjbs.com",
    "Sushanta",
    "Chakraborty",
    roleSalesLead.id,
    buB2G.id,
    "7846871000"
  );
  const uSwaraj = await u(
    "bS-R-22042",
    "sea06@sfjbs.com",
    "Swaraj",
    "Kumar Routray",
    roleSales.id,
    buB2G.id,
    "7873226000"
  );
  const uShylaja = await u(
    "SFJ-R-11634",
    "ta7181@sfjbs.com",
    "Shylaja",
    "Pragash",
    roleDeliveryManager.id,
    buB2G.id,
    "9600207000"
  );
  const uStephen = await u(
    "bS-R-21741",
    "ta7165@sfjbs.com",
    "Stephen",
    "Raj C",
    roleRecruiter.id,
    buB2G.id,
    "7411452000"
  );
  const uNulu = await u(
    "SFJ-NULU-001",
    "nulu.sankaramma@sfjbs.com",
    "Nulu",
    "Sankaramma",
    roleHR.id,
    buB2G.id
  );

  console.log("  ✓ 74 users\n");

  // ───────────────────────────────────────────────────────────────────────
  // REPORTING LINES
  // ───────────────────────────────────────────────────────────────────────
  console.log("▶ Reporting lines...");

  const wire = (uid: string, mid: string) =>
    prisma.user.update({ where: { id: uid }, data: { reportingToId: mid } });

  // → Siva (CEO)
  for (const uid of [
    uRakhi.id,
    uYatin.id,
    uYesvanth.id,
    uSaijal.id,
    uJoanna.id,
    uMadhavi.id,
  ])
    await wire(uid, userSiva.id);

  // → Rakhi Sen
  for (const uid of [
    uAjay.id,
    uAkash.id,
    uManishaJK.id,
    uRitu.id,
    uSoma.id,
    uLikhitha.id,
    uSarala.id,
    uAnanyaAR.id,
    uTamilS.id,
    uShylaja.id,
    uSushanta.id,
  ])
    await wire(uid, uRakhi.id);

  // → Saijal
  await wire(uKarthDM.id, uSaijal.id);

  // → Karthikeyan Ganeshan
  for (const uid of [
    uAbhilash.id,
    uMunaff.id,
    uPrakash.id,
    uRaviPT.id,
    uSibbala.id,
    uTejash.id,
  ])
    await wire(uid, uKarthDM.id);

  // → Likhitha
  for (const uid of [
    uLathika.id,
    uMPooja.id,
    uNeha.id,
    uPriyanka.id,
    uSavithri.id,
    uSowndhary.id,
    uVadlamudi.id,
  ])
    await wire(uid, uLikhitha.id);

  // → Sarala
  for (const uid of [uGeethika.id, uRamLaksh.id, uSamiksh.id])
    await wire(uid, uSarala.id);

  // → Madhavi
  for (const uid of [uRoja.id, uAnshita.id, uMuskanJ.id, uAnuj.id, uManish.id])
    await wire(uid, uMadhavi.id);

  // → Roja
  for (const uid of [
    uVarna.id,
    uAkkala.id,
    uBhushan.id,
    uMeenaksh.id,
    uDJamuna.id,
    uDanam.id,
    uJyothi.id,
    uLatha.id,
    uPavan.id,
  ])
    await wire(uid, uRoja.id);

  // → Yesvanth
  for (const uid of [
    uDeivan.id,
    uAishw.id,
    uHemalD.id,
    uKoduru.id,
    uPayal.id,
    uRajat.id,
    uSangeetha.id,
    uSubhasmi.id,
    uSubhasre.id,
    uVasanth.id,
    uVemula.id,
  ])
    await wire(uid, uYesvanth.id);

  // → Yatin
  await wire(uSyedS.id, uYatin.id);

  // → Ritu / Soma
  await wire(uArockiya.id, uRitu.id);
  await wire(uKarthK.id, uSoma.id);
  await wire(uRadha.id, uSoma.id);

  // → Nulu
  await wire(uMenka.id, uNulu.id);
  await wire(uVarsha.id, uNulu.id);

  // B2G
  for (const uid of [uDhanesh.id, uHemaKB.id, uShaikMA.id, uVyshnavi.id])
    await wire(uid, uJoanna.id);
  await wire(uSwaraj.id, uSushanta.id);
  await wire(uStephen.id, uShylaja.id);

  console.log("  ✓ Reporting lines wired\n");

  // ───────────────────────────────────────────────────────────────────────
  // TEAM MEMBERS
  // ───────────────────────────────────────────────────────────────────────
  console.log("▶ Team memberships...");

  const mkMember = async (
    userId: string,
    teamId: string,
    role: "LEAD" | "CO_LEAD" | "MEMBER" = "MEMBER"
  ) => {
    const exists = await prisma.teamMember.findUnique({
      where: { userId_teamId: { userId, teamId } },
    });
    if (exists) return exists;
    return prisma.teamMember.create({
      data: { userId, teamId, teamRole: role, isActive: true },
    });
  };

  // KaaS Sales
  await mkMember(uRakhi.id, tKaaSales.id, "LEAD");
  await mkMember(uYatin.id, tKaaSales.id, "LEAD");
  await mkMember(uSaijal.id, tKaaSales.id, "CO_LEAD");
  for (const uid of [
    uAjay.id,
    uAkash.id,
    uArockiya.id,
    uKarthK.id,
    uManishaJK.id,
    uRadha.id,
    uRitu.id,
    uSoma.id,
    uSyedS.id,
  ])
    await mkMember(uid, tKaaSales.id);

  // KaaS Delivery Karthik
  await mkMember(uSaijal.id, tKaasKarthik.id, "LEAD");
  await mkMember(uKarthDM.id, tKaasKarthik.id, "CO_LEAD");
  for (const uid of [
    uAbhilash.id,
    uMunaff.id,
    uPrakash.id,
    uRaviPT.id,
    uSibbala.id,
    uTejash.id,
  ])
    await mkMember(uid, tKaasKarthik.id);

  // KaaS Delivery Likitha
  await mkMember(uLikhitha.id, tKaasLikitha.id, "LEAD");
  for (const uid of [
    uLathika.id,
    uMPooja.id,
    uNeha.id,
    uPriyanka.id,
    uSavithri.id,
    uSowndhary.id,
    uVadlamudi.id,
  ])
    await mkMember(uid, tKaasLikitha.id);

  // KaaS Delivery Sarala
  await mkMember(uSarala.id, tKaasSarala.id, "LEAD");
  for (const uid of [uGeethika.id, uRamLaksh.id, uSamiksh.id])
    await mkMember(uid, tKaasSarala.id);

  // KaaS IMS
  for (const uid of [uBhoomika.id, uMuskanIMS.id])
    await mkMember(uid, tKaasIMS.id);

  // TaaS Roja
  await mkMember(uRoja.id, tTaasRoja.id, "LEAD");
  await mkMember(uVarna.id, tTaasRoja.id, "CO_LEAD");
  for (const uid of [
    uAkkala.id,
    uBhushan.id,
    uMeenaksh.id,
    uDJamuna.id,
    uDanam.id,
    uJyothi.id,
    uLatha.id,
    uPavan.id,
  ])
    await mkMember(uid, tTaasRoja.id);

  // TaaS Yesvanth
  await mkMember(uYesvanth.id, tTaasYesv.id, "LEAD");
  await mkMember(uDeivan.id, tTaasYesv.id, "CO_LEAD");
  for (const uid of [
    uAishw.id,
    uHemalD.id,
    uKoduru.id,
    uPayal.id,
    uRajat.id,
    uSangeetha.id,
    uSubhasmi.id,
    uSubhasre.id,
    uVasanth.id,
    uVemula.id,
  ])
    await mkMember(uid, tTaasYesv.id);

  // CSR
  await mkMember(uMadhavi.id, tCSR.id, "LEAD");
  for (const uid of [uAnshita.id, uMuskanJ.id]) await mkMember(uid, tCSR.id);
  await mkMember(uMadhavi.id, tCSRCluster1.id, "LEAD");
  await mkMember(uAnuj.id, tCSRCluster3.id);
  await mkMember(uManish.id, tCSRCluster3.id);

  // B2G
  await mkMember(uJoanna.id, tB2GHiring.id, "LEAD");
  await mkMember(uMadhavi.id, tB2GHiring.id, "CO_LEAD");
  for (const uid of [
    uDhanesh.id,
    uHemaKB.id,
    uMenka.id,
    uShaikMA.id,
    uVarsha.id,
    uVyshnavi.id,
  ])
    await mkMember(uid, tB2GHiring.id);

  await mkMember(uAnanyaAR.id, tB2GCluster1.id);
  await mkMember(uTamilS.id, tB2GCluster1.id);

  await mkMember(uSushanta.id, tB2GCluster4.id, "LEAD");
  await mkMember(uSwaraj.id, tB2GCluster4.id);

  await mkMember(uShylaja.id, tB2GShylaja.id, "LEAD");
  await mkMember(uStephen.id, tB2GShylaja.id);

  console.log("  ✓ All memberships set\n");

  // ───────────────────────────────────────────────────────────────────────
  // TEAM EDGES
  // ───────────────────────────────────────────────────────────────────────
  console.log("▶ Team edges...");

  const mkEdge = async (
    parentId: string,
    childId: string,
    edgeType: "ASSIGNS_TO" | "REPORTS_TO" | "VISIBILITY"
  ) => {
    const exists = await prisma.teamEdge.findUnique({
      where: { parentId_childId_edgeType: { parentId, childId, edgeType } },
    });
    if (exists) return exists;
    return prisma.teamEdge.create({
      data: { parentId, childId, edgeType, isActive: true },
    });
  };

  // ASSIGNS_TO (canvas hierarchy)
  await mkEdge(tKaaSales.id, tKaasKarthik.id, "ASSIGNS_TO");
  await mkEdge(tKaaSales.id, tKaasLikitha.id, "ASSIGNS_TO");
  await mkEdge(tKaaSales.id, tKaasSarala.id, "ASSIGNS_TO");
  await mkEdge(tB2GHiring.id, tTaasRoja.id, "ASSIGNS_TO");
  await mkEdge(tB2GHiring.id, tTaasYesv.id, "ASSIGNS_TO");
  await mkEdge(tB2GHiring.id, tB2GCluster1.id, "ASSIGNS_TO");
  await mkEdge(tB2GHiring.id, tB2GCluster4.id, "ASSIGNS_TO");
  await mkEdge(tB2GHiring.id, tB2GShylaja.id, "ASSIGNS_TO");

  // REPORTS_TO (org line)
  await mkEdge(tKaaSales.id, tKaasKarthik.id, "REPORTS_TO");
  await mkEdge(tKaaSales.id, tKaasLikitha.id, "REPORTS_TO");
  await mkEdge(tKaaSales.id, tKaasSarala.id, "REPORTS_TO");
  await mkEdge(tCSR.id, tCSRCluster1.id, "REPORTS_TO");
  await mkEdge(tCSR.id, tCSRCluster3.id, "REPORTS_TO");

  console.log("  ✓ Edges set\n");

  // ───────────────────────────────────────────────────────────────────────
  // CLIENTS (5) — handlers + contacts from sales people only
  // ───────────────────────────────────────────────────────────────────────
  console.log("▶ Clients...");

  const mkClient = async (opts: {
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
    handlers: { userId: string; role: "PRIMARY" | "SECONDARY" | "BACKUP" }[];
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
    const exists = await prisma.client.findFirst({
      where: { name: opts.name },
    });
    if (exists) {
      console.log(`    → ${opts.name} already exists`);
      return exists;
    }

    const client = await prisma.client.create({
      data: {
        name: opts.name,
        vmsName: opts.vmsName,
        category: opts.category as any,
        industry: opts.industry,
        website: opts.website,
        country: opts.country,
        city: opts.city,
        status: "ACTIVE",
        businessUnitId: opts.buId,
        createdById: opts.createdById,
        approvedById: opts.approvedById,
        approvedAt: now,
      },
    });
    for (const h of opts.handlers)
      await prisma.clientHandler.create({
        data: {
          clientId: client.id,
          userId: h.userId,
          role: h.role,
          status: "ACTIVE",
          assignedById: userSiva.id,
        },
      });
    for (const c of opts.contacts)
      await prisma.clientContact.create({
        data: { clientId: client.id, ...c, status: "ACTIVE" },
      });
    return client;
  };

  const cCapgemini = await mkClient({
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
    handlers: [
      { userId: uRoja.id, role: "PRIMARY" },
      { userId: uAjay.id, role: "SECONDARY" },
    ],
    contacts: [
      {
        firstName: "Ramesh",
        lastName: "Iyer",
        designation: "TA Lead",
        email: "ramesh.iyer@capgemini.com",
        phone: "9800000001",
        isPrimary: true,
        ownerId: uRoja.id,
      },
      {
        firstName: "Preethi",
        lastName: "Nair",
        designation: "HR BP",
        email: "preethi.nair@capgemini.com",
        phone: "9800000002",
        isPrimary: false,
        ownerId: uAjay.id,
      },
    ],
  });

  const cCognizant = await mkClient({
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
    handlers: [
      { userId: uArockiya.id, role: "PRIMARY" },
      { userId: uRitu.id, role: "SECONDARY" },
    ],
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

  const cNM = await mkClient({
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
    handlers: [
      { userId: uShylaja.id, role: "PRIMARY" },
      { userId: uSushanta.id, role: "SECONDARY" },
    ],
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

  const cTCS = await mkClient({
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
    handlers: [
      { userId: uSoma.id, role: "PRIMARY" },
      { userId: uManishaJK.id, role: "SECONDARY" },
    ],
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

  const cNASSCOM = await mkClient({
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
    handlers: [{ userId: uSushanta.id, role: "PRIMARY" }],
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

  console.log("  ✓ 5 clients seeded\n");

  // ───────────────────────────────────────────────────────────────────────
  // REQUIREMENTS (9)
  // ───────────────────────────────────────────────────────────────────────
  console.log("▶ Requirements...");

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
    const exists = await prisma.requirement.findUnique({
      where: { reqCode: opts.code },
    });
    if (exists) return exists;

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

    await prisma.requirementAssignment.create({
      data: {
        requirementId: req.id,
        assignmentType: "TEAM" as any,
        status: "ACTIVE" as any,
        teamId: opts.teamId,
        assignedById: opts.createdById,
      },
    });

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
        },
      });
    }
    return req;
  };

  await mkReq({
    code: "REQ-CAP-001",
    title: "Senior Java Developer",
    clientId: cCapgemini.id,
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
    teamId: tTaasRoja.id,
    recruiterId: uLatha.id,
  });
  await mkReq({
    code: "REQ-CAP-002",
    title: "DevOps Engineer (Contract)",
    clientId: cCapgemini.id,
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
    teamId: tTaasYesv.id,
    recruiterId: uDeivan.id,
  });
  await mkReq({
    code: "REQ-CAP-003",
    title: "Python Data Analyst",
    clientId: cCapgemini.id,
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
    teamId: tKaasKarthik.id,
  });
  await mkReq({
    code: "REQ-CTS-001",
    title: "Sr. React Developer",
    clientId: cCognizant.id,
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
    teamId: tKaasLikitha.id,
    recruiterId: uLikhitha.id,
  });
  await mkReq({
    code: "REQ-CTS-002",
    title: "SAP FICO Consultant",
    clientId: cCognizant.id,
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
    teamId: tKaasSarala.id,
    recruiterId: uSarala.id,
  });
  await mkReq({
    code: "REQ-CTS-003",
    title: "QA Automation Lead",
    clientId: cCognizant.id,
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
    teamId: tKaasKarthik.id,
  });
  await mkReq({
    code: "REQ-NM-001",
    title: "AWS Cloud Trainer",
    clientId: cNM.id,
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
    teamId: tB2GShylaja.id,
    recruiterId: uStephen.id,
  });
  await mkReq({
    code: "REQ-NM-002",
    title: "Cybersecurity Trainer Batch",
    clientId: cNM.id,
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
    teamId: tB2GCluster1.id,
    recruiterId: uAnanyaAR.id,
  });
  await mkReq({
    code: "REQ-NM-003",
    title: "University Skilling Program",
    clientId: cNM.id,
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
    teamId: tB2GCluster4.id,
  });

  console.log("  ✓ 9 requirements + assignments\n");

  // ───────────────────────────────────────────────────────────────────────
  // CREDENTIALS SUMMARY
  // ───────────────────────────────────────────────────────────────────────
  console.log(
    "╔══════════════════════════════════════════════════════════════════╗"
  );
  console.log(
    "║                      CREDENTIALS                                ║"
  );
  console.log(
    "╠══════════════════════════════════════════════════════════════════╣"
  );
  console.log(
    "║  Super Admin  : siva.sarathy@sfjbs.com   / admin@123            ║"
  );
  console.log(
    "║  All others   : <their email>            / pass@123             ║"
  );
  console.log(
    "╠══════════════════════════════════════════════════════════════════╣"
  );
  console.log(
    "║  Sales Lead   : rakhi.d@sfjbs.com        / pass@123             ║"
  );
  console.log(
    "║  Sales Lead   : yesvanth@sfjbs.com       / pass@123             ║"
  );
  console.log(
    "║  Sales Lead   : am242@sfjbs.com          / pass@123  (Sushanta) ║"
  );
  console.log(
    "║  Delivery Mgr : saijal.s@sfjbs.com       / pass@123             ║"
  );
  console.log(
    "║  Delivery Mgr : ta104@sfjbs.com          / pass@123  (Roja)     ║"
  );
  console.log(
    "║  Delivery TL  : ta7009@sfjbs.com         / pass@123  (Likhitha) ║"
  );
  console.log(
    "║  Recruiter    : ta123@sfjbs.com          / pass@123  (Karthik)  ║"
  );
  console.log(
    "║  HR Lead      : hr@sfjbs.com             / pass@123  (Madhavi)  ║"
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
