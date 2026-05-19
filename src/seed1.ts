// prisma/seed.ts
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const hash = (p: string) => bcrypt.hashSync(p, 10);
const DEFAULT_PASS = "pass@123";

async function main() {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║         TalentOS Seed Starting           ║");
  console.log("╚══════════════════════════════════════════╝\n");

  // ─────────────────────────────────────────────────────────────────────────
  // ROLES
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding roles...");

  const mkRole = async (
    name: string,
    description: string,
    perms: {
      module: string;
      canView: boolean;
      canAdd: boolean;
      canEdit: boolean;
      canDelete: boolean;
      canViewScope: string;
      canAddScope: string;
      canEditScope: string;
      canDeleteScope: string;
    }[]
  ) =>
    prisma.role.upsert({
      where: { name },
      update: {},
      create: {
        name,
        description,
        isSystem: false,
        permissions: {
          create: perms.map((p) => ({
            module: p.module,
            canView: p.canView,
            canAdd: p.canAdd,
            canEdit: p.canEdit,
            canDelete: p.canDelete,
            canViewScope: p.canViewScope as any,
            canAddScope: p.canAddScope as any,
            canEditScope: p.canEditScope as any,
            canDeleteScope: p.canDeleteScope as any,
          })),
        },
      },
    });

  const ALL = "ALL",
    BU = "BU",
    DEPT = "DEPARTMENT",
    OWN = "OWN";

  const roleSuperAdmin = await mkRole("Super Admin", "Full system access", [
    {
      module: "users",
      canView: true,
      canAdd: true,
      canEdit: true,
      canDelete: true,
      canViewScope: ALL,
      canAddScope: ALL,
      canEditScope: ALL,
      canDeleteScope: ALL,
    },
    {
      module: "business_units",
      canView: true,
      canAdd: true,
      canEdit: true,
      canDelete: true,
      canViewScope: ALL,
      canAddScope: ALL,
      canEditScope: ALL,
      canDeleteScope: ALL,
    },
    {
      module: "departments",
      canView: true,
      canAdd: true,
      canEdit: true,
      canDelete: true,
      canViewScope: ALL,
      canAddScope: ALL,
      canEditScope: ALL,
      canDeleteScope: ALL,
    },
    {
      module: "service_lines",
      canView: true,
      canAdd: true,
      canEdit: true,
      canDelete: true,
      canViewScope: ALL,
      canAddScope: ALL,
      canEditScope: ALL,
      canDeleteScope: ALL,
    },
    {
      module: "clients",
      canView: true,
      canAdd: true,
      canEdit: true,
      canDelete: true,
      canViewScope: ALL,
      canAddScope: ALL,
      canEditScope: ALL,
      canDeleteScope: ALL,
    },
    {
      module: "requirements",
      canView: true,
      canAdd: true,
      canEdit: true,
      canDelete: true,
      canViewScope: ALL,
      canAddScope: ALL,
      canEditScope: ALL,
      canDeleteScope: ALL,
    },
  ]);

  const roleSeniorCSM = await mkRole(
    "Senior CSM",
    "Senior client success manager, manages CSMs and DMs",
    [
      {
        module: "clients",
        canView: true,
        canAdd: true,
        canEdit: true,
        canDelete: false,
        canViewScope: ALL,
        canAddScope: ALL,
        canEditScope: ALL,
        canDeleteScope: OWN,
      },
      {
        module: "requirements",
        canView: true,
        canAdd: true,
        canEdit: true,
        canDelete: false,
        canViewScope: ALL,
        canAddScope: ALL,
        canEditScope: ALL,
        canDeleteScope: OWN,
      },
      {
        module: "users",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        canViewScope: ALL,
        canAddScope: OWN,
        canEditScope: OWN,
        canDeleteScope: OWN,
      },
      {
        module: "departments",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        canViewScope: ALL,
        canAddScope: OWN,
        canEditScope: OWN,
        canDeleteScope: OWN,
      },
      {
        module: "service_lines",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        canViewScope: ALL,
        canAddScope: OWN,
        canEditScope: OWN,
        canDeleteScope: OWN,
      },
    ]
  );

  const roleCSM = await mkRole("CSM", "Client success manager", [
    {
      module: "clients",
      canView: true,
      canAdd: true,
      canEdit: true,
      canDelete: false,
      canViewScope: OWN,
      canAddScope: OWN,
      canEditScope: OWN,
      canDeleteScope: OWN,
    },
    {
      module: "requirements",
      canView: true,
      canAdd: true,
      canEdit: false,
      canDelete: false,
      canViewScope: OWN,
      canAddScope: OWN,
      canEditScope: OWN,
      canDeleteScope: OWN,
    },
    {
      module: "users",
      canView: true,
      canAdd: false,
      canEdit: false,
      canDelete: false,
      canViewScope: OWN,
      canAddScope: OWN,
      canEditScope: OWN,
      canDeleteScope: OWN,
    },
  ]);

  const roleDeliveryManager = await mkRole(
    "Delivery Manager",
    "Manages delivery teams",
    [
      {
        module: "requirements",
        canView: true,
        canAdd: false,
        canEdit: true,
        canDelete: false,
        canViewScope: ALL,
        canAddScope: OWN,
        canEditScope: ALL,
        canDeleteScope: OWN,
      },
      {
        module: "clients",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        canViewScope: ALL,
        canAddScope: OWN,
        canEditScope: OWN,
        canDeleteScope: OWN,
      },
      {
        module: "users",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        canViewScope: ALL,
        canAddScope: OWN,
        canEditScope: OWN,
        canDeleteScope: OWN,
      },
    ]
  );

  const roleDeliveryLead = await mkRole(
    "Delivery Lead",
    "Team lead for recruiters",
    [
      {
        module: "requirements",
        canView: true,
        canAdd: false,
        canEdit: true,
        canDelete: false,
        canViewScope: DEPT,
        canAddScope: OWN,
        canEditScope: DEPT,
        canDeleteScope: OWN,
      },
      {
        module: "clients",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        canViewScope: DEPT,
        canAddScope: OWN,
        canEditScope: OWN,
        canDeleteScope: OWN,
      },
      {
        module: "users",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        canViewScope: DEPT,
        canAddScope: OWN,
        canEditScope: OWN,
        canDeleteScope: OWN,
      },
    ]
  );

  const roleRecruiter = await mkRole(
    "Recruiter",
    "Works assigned requirements",
    [
      {
        module: "requirements",
        canView: true,
        canAdd: false,
        canEdit: true,
        canDelete: false,
        canViewScope: OWN,
        canAddScope: OWN,
        canEditScope: OWN,
        canDeleteScope: OWN,
      },
      {
        module: "clients",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        canViewScope: OWN,
        canAddScope: OWN,
        canEditScope: OWN,
        canDeleteScope: OWN,
      },
      {
        module: "users",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        canViewScope: OWN,
        canAddScope: OWN,
        canEditScope: OWN,
        canDeleteScope: OWN,
      },
    ]
  );

  const roleHR = await mkRole(
    "HR / Internal Hiring",
    "HR and internal hiring ops",
    [
      {
        module: "users",
        canView: true,
        canAdd: true,
        canEdit: true,
        canDelete: false,
        canViewScope: ALL,
        canAddScope: ALL,
        canEditScope: ALL,
        canDeleteScope: OWN,
      },
      {
        module: "requirements",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        canViewScope: ALL,
        canAddScope: OWN,
        canEditScope: OWN,
        canDeleteScope: OWN,
      },
      {
        module: "clients",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        canViewScope: ALL,
        canAddScope: OWN,
        canEditScope: OWN,
        canDeleteScope: OWN,
      },
      {
        module: "departments",
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
        canViewScope: ALL,
        canAddScope: OWN,
        canEditScope: OWN,
        canDeleteScope: OWN,
      },
    ]
  );

  console.log("  ✓ 7 roles created\n");

  // ─────────────────────────────────────────────────────────────────────────
  // DEPARTMENTS
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding departments...");

  const mkDept = async (name: string, code: string) =>
    prisma.department.upsert({
      where: { name },
      update: {},
      create: { name, code, isActive: true },
    });

  const deptKaaSDelivery = await mkDept("KaaS Delivery", "KAAS-DEL");
  const deptKaaSales = await mkDept("KaaS Sales", "KAAS-SAL");
  const deptTaaSDelivery = await mkDept("TaaS Delivery", "TAAS-DEL");
  const deptB2GDelivery = await mkDept("B2G Delivery", "B2G-DEL");
  const deptInternalHiring = await mkDept("Internal Hiring", "INT-HIRE");

  console.log("  ✓ 5 departments created\n");

  // ─────────────────────────────────────────────────────────────────────────
  // SERVICE LINES
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding service lines...");

  const mkSL = async (name: string, code: string) =>
    prisma.serviceLine.upsert({
      where: { name },
      update: {},
      create: { name, code, isActive: true },
    });

  const slKaaS = await mkSL("Knowledge as a Service", "KAAS");
  const slTaaS = await mkSL("Talent as a Service", "TAAS");
  const slCSR = await mkSL("CSR", "CSR");
  const slOEM = await mkSL("OEM", "OEM");

  console.log("  ✓ 4 service lines created\n");

  // ─────────────────────────────────────────────────────────────────────────
  // BUSINESS UNITS
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding business units...");

  // root BUs first — no parent so ancestorIds = []
  const buEnterprise = await prisma.businessUnit.upsert({
    where: { name: "Enterprise" },
    update: {},
    create: {
      name: "Enterprise",
      code: "ENT",
      isActive: true,
      ancestorIds: [],
    },
  });

  const buB2G = await prisma.businessUnit.upsert({
    where: { name: "B2G" },
    update: {},
    create: {
      name: "B2G",
      code: "B2G",
      isActive: true,
      ancestorIds: [],
      parentBUId: null,
    },
  });

  const buB2I = await prisma.businessUnit.upsert({
    where: { name: "B2I" },
    update: {},
    create: {
      name: "B2I",
      code: "B2I",
      isActive: true,
      ancestorIds: [],
      parentBUId: null,
    },
  });

  // sub BUs — ancestorIds = [parentId]
  const buEnterpriseIT = await prisma.businessUnit.upsert({
    where: { name: "Enterprise - IT" },
    update: {},
    create: {
      name: "Enterprise - IT",
      code: "ENT-IT",
      isActive: true,
      parentBUId: buEnterprise.id,
      ancestorIds: [buEnterprise.id],
    },
  });

  const buEnterpriseNonIT = await prisma.businessUnit.upsert({
    where: { name: "Enterprise - Non IT" },
    update: {},
    create: {
      name: "Enterprise - Non IT",
      code: "ENT-NIT",
      isActive: true,
      parentBUId: buEnterprise.id,
      ancestorIds: [buEnterprise.id],
    },
  });

  const buB2GSkilling = await prisma.businessUnit.upsert({
    where: { name: "B2G Skilling" },
    update: {},
    create: {
      name: "B2G Skilling",
      code: "B2G-SKL",
      isActive: true,
      parentBUId: buB2G.id,
      ancestorIds: [buB2G.id],
    },
  });

  const buB2GCPSU = await prisma.businessUnit.upsert({
    where: { name: "B2G CPSU" },
    update: {},
    create: {
      name: "B2G CPSU",
      code: "B2G-CPSU",
      isActive: true,
      parentBUId: buB2G.id,
      ancestorIds: [buB2G.id],
    },
  });

  console.log("  ✓ 7 BUs created (Enterprise, B2G, B2I + sub-BUs)\n");

  // ─────────────────────────────────────────────────────────────────────────
  // USERS
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding users...");

  const mkUser = async (opts: {
    empId: string;
    email: string;
    firstName: string;
    lastName: string;
    roleId: string;
    deptId?: string;
    phone?: string;
    isSuperAdmin?: boolean;
    employeeId?: string;
  }) =>
    prisma.user.upsert({
      where: { email: opts.email },
      update: {},
      create: {
        email: opts.email,
        passwordHash: hash(opts.isSuperAdmin ? "admin@123" : DEFAULT_PASS),
        firstName: opts.firstName,
        lastName: opts.lastName,
        employeeId: opts.empId,
        phone: opts.phone ?? null,
        isActive: true,
        isSuperAdmin: opts.isSuperAdmin ?? false,
        roleId: opts.roleId,
        departmentId: opts.deptId ?? null,
      },
    });

  // ── CEO ──────────────────────────────────────────────────────────────────
  const uSiva = await mkUser({
    empId: "SFJ-CEO-001",
    email: "siva.sarathy@sfjbs.com",
    firstName: "Siva",
    lastName: "Sarathy",
    roleId: roleSuperAdmin.id,
    isSuperAdmin: true,
  });

  // ── KaaS Senior CSMs (report to Siva) ────────────────────────────────────
  const uRakhi = await mkUser({
    empId: "SFJ-R-9439",
    email: "rakhi.d@sfjbs.com",
    firstName: "Rakhi",
    lastName: "Sen",
    roleId: roleSeniorCSM.id,
    deptId: deptKaaSales.id,
    phone: "9972509000",
  });

  const uYatin = await mkUser({
    empId: "SFJ-R-9839",
    email: "anand.y@sfjbs.com",
    firstName: "Yatin",
    lastName: "Anand",
    roleId: roleSeniorCSM.id,
    deptId: deptKaaSales.id,
    phone: "7838823000",
  });

  // ── CSMs reporting to Rakhi ───────────────────────────────────────────────
  const uAjay = await mkUser({
    empId: "SFJ-R-11794",
    email: "csm23@sfjbs.com",
    firstName: "Ajay",
    lastName: "D",
    roleId: roleCSM.id,
    deptId: deptKaaSales.id,
    phone: "9148529000",
  });

  const uAkash = await mkUser({
    empId: "bS-R-21970",
    email: "impact01@bskilling.com",
    firstName: "Akash",
    lastName: "J",
    roleId: roleCSM.id,
    deptId: deptKaaSales.id,
    phone: "8113051000",
  });

  const uManishaJK = await mkUser({
    empId: "SFJ-R-11201",
    email: "csm04@sfjbs.com",
    firstName: "Manisha",
    lastName: "J Kumar",
    roleId: roleCSM.id,
    deptId: deptKaaSales.id,
    phone: "6281688000",
  });

  const uRadha = await mkUser({
    empId: "bS-R-21971",
    email: "impact02@bskilling.com",
    firstName: "Radha",
    lastName: "A",
    roleId: roleCSM.id,
    deptId: deptKaaSales.id,
    phone: "9080205000",
  });

  const uRitu = await mkUser({
    empId: "SFJ-R-11526",
    email: "ta221@sfjbs.com",
    firstName: "Ritu",
    lastName: "Seharawat",
    roleId: roleCSM.id,
    deptId: deptKaaSales.id,
    phone: "9902201000",
  });

  const uSoma = await mkUser({
    empId: "SFJ-R-11890",
    email: "csm19@sfjbs.com",
    firstName: "Somashekar",
    lastName: "P M",
    roleId: roleCSM.id,
    deptId: deptKaaSales.id,
    phone: "9342768000",
  });

  // ── DMs reporting to Rakhi ────────────────────────────────────────────────
  // Papitha — new DM, not in employee sheet but in hierarchy
  const uPapitha = await mkUser({
    empId: "SFJ-PAPITHA-001",
    email: "papitha@sfjbs.com",
    firstName: "Papitha",
    lastName: "",
    roleId: roleDeliveryManager.id,
    deptId: deptKaaSDelivery.id,
  });

  const uSarala = await mkUser({
    empId: "SFJ-R-22064",
    email: "ta7069@sfjbs.com",
    firstName: "G M",
    lastName: "Sarala",
    roleId: roleDeliveryManager.id,
    deptId: deptKaaSDelivery.id,
    phone: "8088623000",
  });

  // ── DL reporting to Papitha ───────────────────────────────────────────────
  const uLikhitha = await mkUser({
    empId: "SFJ-R-11132",
    email: "ta7009@sfjbs.com",
    firstName: "Likhitha",
    lastName: "R",
    roleId: roleDeliveryLead.id,
    deptId: deptKaaSDelivery.id,
    phone: "9980496000",
  });

  // ── Recruiters under Likhitha ────────────────────────────────────────────
  const uLathika = await mkUser({
    empId: "SFJ-R-12009",
    email: "ta7002@sfjbs.com",
    firstName: "Lathika",
    lastName: "Devi S",
    roleId: roleRecruiter.id,
    deptId: deptKaaSDelivery.id,
    phone: "9940027000",
  });

  const uMPooja = await mkUser({
    empId: "SFJ-R-11305",
    email: "ta7102@sfjbs.com",
    firstName: "M",
    lastName: "Pooja",
    roleId: roleRecruiter.id,
    deptId: deptKaaSDelivery.id,
    phone: "9632795000",
  });

  const uNeha = await mkUser({
    empId: "bS-R-22040",
    email: "ta7170@sfjbs.com",
    firstName: "Neha",
    lastName: "Pandey",
    roleId: roleRecruiter.id,
    deptId: deptKaaSDelivery.id,
    phone: "9579013000",
  });

  const uPriyanka = await mkUser({
    empId: "bS-R-22016",
    email: "ta7172@sfjbs.com",
    firstName: "Priyanka",
    lastName: "Singh",
    roleId: roleRecruiter.id,
    deptId: deptKaaSDelivery.id,
    phone: "8709507000",
  });

  const uSowndhary = await mkUser({
    empId: "bS-R-22043",
    email: "ta4170@sfjbs.com",
    firstName: "Sowndharya",
    lastName: "S",
    roleId: roleRecruiter.id,
    deptId: deptKaaSDelivery.id,
    phone: "8056925000",
  });

  // ── Recruiters under Sarala ──────────────────────────────────────────────
  const uGeethika = await mkUser({
    empId: "bS-R-22059",
    email: "ta7162@sfjbs.com",
    firstName: "Geethika",
    lastName: "Palanisamy",
    roleId: roleRecruiter.id,
    deptId: deptKaaSDelivery.id,
    phone: "9361455000",
  });

  const uRamLaksh = await mkUser({
    empId: "bS-R-22049",
    email: "ta305@sfjbs.com",
    firstName: "Ramlakshmanan",
    lastName: "V",
    roleId: roleRecruiter.id,
    deptId: deptKaaSDelivery.id,
    phone: "9629305000",
  });

  const uSamiksh = await mkUser({
    empId: "SFJ-R-12036",
    email: "ta4197@sfjbs.com",
    firstName: "Samikshya",
    lastName: "Sahu",
    roleId: roleRecruiter.id,
    deptId: deptKaaSDelivery.id,
    phone: "6370171000",
  });

  // ── DM under Yatin — Saijal (reports to Siva directly per hierarchy) ─────
  const uSaijal = await mkUser({
    empId: "SFJ-R-9323",
    email: "saijal.s@sfjbs.com",
    firstName: "Saijal",
    lastName: "S",
    roleId: roleDeliveryManager.id,
    deptId: deptKaaSDelivery.id,
    phone: "7950827000",
  });

  // ── DL under Saijal ──────────────────────────────────────────────────────
  const uKarthDM = await mkUser({
    empId: "SFJ-R-9771",
    email: "ta123@sfjbs.com",
    firstName: "Karthikeyan",
    lastName: "Ganeshan",
    roleId: roleDeliveryLead.id,
    deptId: deptKaaSDelivery.id,
    phone: "8884050000",
  });

  // ── Recruiters under Karthikeyan ─────────────────────────────────────────
  const uAbhilash = await mkUser({
    empId: "SFJ-R-11909",
    email: "ta7159@sfjbs.com",
    firstName: "Abhilash",
    lastName: "V S",
    roleId: roleRecruiter.id,
    deptId: deptKaaSDelivery.id,
    phone: "7012913000",
  });

  const uMunaff = await mkUser({
    empId: "SFJ-R-11434",
    email: "ta7142@sfjbs.com",
    firstName: "Mohammed",
    lastName: "Munaff",
    roleId: roleRecruiter.id,
    deptId: deptKaaSDelivery.id,
    phone: "8884252000",
  });

  const uRaviPT = await mkUser({
    empId: "bS-R-21905",
    email: "ta7133@sfjbs.com",
    firstName: "Ravi",
    lastName: "Prakash Tiwari",
    roleId: roleRecruiter.id,
    deptId: deptKaaSDelivery.id,
    phone: "9990611000",
  });

  const uSibbala = await mkUser({
    empId: "SFJ-R-11495",
    email: "ta4186@sfjbs.com",
    firstName: "Sibbala",
    lastName: "Ravi Sankar",
    roleId: roleRecruiter.id,
    deptId: deptKaaSDelivery.id,
    phone: "8885314000",
  });

  const uTejash = await mkUser({
    empId: "SFJ-R-11899",
    email: "ta7132@sfjbs.com",
    firstName: "Tejashwini",
    lastName: "M",
    roleId: roleRecruiter.id,
    deptId: deptKaaSDelivery.id,
    phone: "9108382000",
  });

  // ── TaaS — Roja (reports to Siva) ────────────────────────────────────────
  const uRoja = await mkUser({
    empId: "SFJ-R-9628",
    email: "ta104@sfjbs.com",
    firstName: "Roja",
    lastName: "Chennacetty",
    roleId: roleDeliveryManager.id,
    deptId: deptTaaSDelivery.id,
    phone: "7899725000",
  });

  const uAkkala = await mkUser({
    empId: "SFJ-R-22055",
    email: "ta4199@sfjbs.com",
    firstName: "Akkaladevi",
    lastName: "Bhagyasree",
    roleId: roleRecruiter.id,
    deptId: deptTaaSDelivery.id,
    phone: "6303499000",
  });

  const uBhushan = await mkUser({
    empId: "bS-R-20525",
    email: "ta204@sfjbs.com",
    firstName: "Bhushana",
    lastName: "Tumati",
    roleId: roleRecruiter.id,
    deptId: deptTaaSDelivery.id,
    phone: "8946035000",
  });

  const uLatha = await mkUser({
    empId: "SFJ-R-9284",
    email: "latha.t@sfjbs.com",
    firstName: "Latha",
    lastName: "Tumati",
    roleId: roleRecruiter.id,
    deptId: deptTaaSDelivery.id,
    phone: "8147087000",
  });

  const uDJamuna = await mkUser({
    empId: "bS-R-22061",
    email: "ta7121@sfjbs.com",
    firstName: "D",
    lastName: "Jamuna",
    roleId: roleRecruiter.id,
    deptId: deptTaaSDelivery.id,
    phone: "7207841000",
  });

  const uDanam = await mkUser({
    empId: "SFJ-R-10876",
    email: "ta334@sfjbs.com",
    firstName: "Danam",
    lastName: "Purnachandra Rao",
    roleId: roleRecruiter.id,
    deptId: deptTaaSDelivery.id,
    phone: "7093245000",
  });

  const uJyothi = await mkUser({
    empId: "SFJ-R-10862",
    email: "ta330@sfjbs.com",
    firstName: "Jyothi",
    lastName: "Jakkula",
    roleId: roleRecruiter.id,
    deptId: deptTaaSDelivery.id,
    phone: "7842432000",
  });

  const uMeenaksh = await mkUser({
    empId: "SFJ-R-11727",
    email: "ta4182@sfjbs.com",
    firstName: "C",
    lastName: "Meenakshi",
    roleId: roleRecruiter.id,
    deptId: deptTaaSDelivery.id,
    phone: "8179395000",
  });

  const uPavan = await mkUser({
    empId: "bS-R-22035",
    email: "ta107@sfjbs.com",
    firstName: "Pavan",
    lastName: "Kumar Chetty",
    roleId: roleRecruiter.id,
    deptId: deptTaaSDelivery.id,
    phone: "9618599000",
  });

  // ── TaaS — Yesvanth (reports to Siva) ────────────────────────────────────
  const uYesvanth = await mkUser({
    empId: "SFJ-R-10475",
    email: "yesvanth@sfjbs.com",
    firstName: "Yesvanth",
    lastName: "Kumar",
    roleId: roleDeliveryManager.id,
    deptId: deptTaaSDelivery.id,
    phone: "9884102000",
  });

  // DL under Yesvanth — Deivanai
  const uDeivan = await mkUser({
    empId: "SFJ-R-10678",
    email: "cg_captive005@sfjbs.com",
    firstName: "Deivanai",
    lastName: "Subbiah",
    roleId: roleDeliveryLead.id,
    deptId: deptTaaSDelivery.id,
    phone: "7904599000",
  });

  const uRajat = await mkUser({
    empId: "SFJ-R-11590",
    email: "ta7175@sfjbs.com",
    firstName: "Rajat",
    lastName: "",
    roleId: roleRecruiter.id,
    deptId: deptTaaSDelivery.id,
    phone: "9663122000",
  });

  const uSangeetha = await mkUser({
    empId: "SFJ-R-10705",
    email: "cg_captive004@sfjbs.com",
    firstName: "Sangeethapriya",
    lastName: "Yuvarajan",
    roleId: roleRecruiter.id,
    deptId: deptTaaSDelivery.id,
    phone: "8778100000",
  });

  const uSubhasmi = await mkUser({
    empId: "SFJ-R-9843",
    email: "cg_captive007@sfjbs.com",
    firstName: "Subhasmita",
    lastName: "Barik",
    roleId: roleRecruiter.id,
    deptId: deptTaaSDelivery.id,
    phone: "8553943000",
  });

  const uVasanth = await mkUser({
    empId: "bS-R-21745",
    email: "cg_captive006@sfjbs.com",
    firstName: "Vasanth",
    lastName: "P",
    roleId: roleRecruiter.id,
    deptId: deptTaaSDelivery.id,
    phone: "9360007000",
  });

  const uVemula = await mkUser({
    empId: "bS-R-22057",
    email: "cg_captive063@sfjbs.com",
    firstName: "Vemula",
    lastName: "Charan",
    roleId: roleRecruiter.id,
    deptId: deptTaaSDelivery.id,
    phone: "6301715000",
  });

  // DL under Yesvanth — Subhasree
  const uSubhasre = await mkUser({
    empId: "SFJ-R-11062",
    email: "ta425@sfjbs.com",
    firstName: "Subhasree",
    lastName: "Patro",
    roleId: roleDeliveryLead.id,
    deptId: deptTaaSDelivery.id,
    phone: "7978551000",
  });

  const uKoduru = await mkUser({
    empId: "bS-R-21919",
    email: "cg_captive039@sfjbs.com",
    firstName: "Koduru",
    lastName: "Chinni Ragavamma",
    roleId: roleRecruiter.id,
    deptId: deptTaaSDelivery.id,
    phone: "9550308000",
  });

  const uPayal = await mkUser({
    empId: "bS-R-22006",
    email: "cg_captive067@sfjbs.com",
    firstName: "Payal",
    lastName: "Kumari",
    roleId: roleRecruiter.id,
    deptId: deptTaaSDelivery.id,
    phone: "9608337000",
  });

  const uAishw = await mkUser({
    empId: "bS-R-22054",
    email: "cg_captive009@sfjbs.com",
    firstName: "Aishwarya",
    lastName: "",
    roleId: roleRecruiter.id,
    deptId: deptTaaSDelivery.id,
    phone: "7906508000",
  });

  // ── Internal Hiring — Madhavi (reports to Siva) ───────────────────────────
  const uMadhavi = await mkUser({
    empId: "SFJ-R-11170",
    email: "hr@sfjbs.com",
    firstName: "Madhavi",
    lastName: "Sengar",
    roleId: roleHR.id,
    deptId: deptInternalHiring.id,
    phone: "7019912000",
  });

  const uMenka = await mkUser({
    empId: "SFJ-R-12041",
    email: "ta4081@sfjbs.com",
    firstName: "Menka",
    lastName: "Rani",
    roleId: roleRecruiter.id,
    deptId: deptInternalHiring.id,
    phone: "7013690000",
  });

  const uVyshnavi = await mkUser({
    empId: "bS-R-21789",
    email: "ta7072@sfjbs.com",
    firstName: "Vyshnavi",
    lastName: "A S",
    roleId: roleRecruiter.id,
    deptId: deptInternalHiring.id,
    phone: "9663488000",
  });

  const uDhanesh = await mkUser({
    empId: "bS-R-21898",
    email: "ta4082@sfjbs.com",
    firstName: "Dhanesh",
    lastName: "K",
    roleId: roleRecruiter.id,
    deptId: deptInternalHiring.id,
    phone: "9495015000",
  });

  const uAqeeb = await mkUser({
    empId: "bS-R-21984",
    email: "ta7138@sfjbs.com",
    firstName: "Shaik",
    lastName: "Mohammed Aqeeb",
    roleId: roleRecruiter.id,
    deptId: deptInternalHiring.id,
    phone: "9502679000",
  });

  const uHemaKB = await mkUser({
    empId: "SFJ-R-11900",
    email: "ta4083@sfjbs.com",
    firstName: "Kalyanabailu",
    lastName: "Hemalatha",
    roleId: roleRecruiter.id,
    deptId: deptInternalHiring.id,
    phone: "9110767000",
  });

  const uAnshita = await mkUser({
    empId: "bS-R-22046",
    email: "ta4016@sfjbs.com",
    firstName: "Anshita",
    lastName: "Mishra",
    roleId: roleRecruiter.id,
    deptId: deptInternalHiring.id,
    phone: "7795049000",
  });

  // Tanuja — in hierarchy sheet but not in employee sheet, add as placeholder
  const uTanuja = await mkUser({
    empId: "SFJ-TANUJA-001",
    email: "tanuja@sfjbs.com",
    firstName: "Tanuja",
    lastName: "",
    roleId: roleRecruiter.id,
    deptId: deptInternalHiring.id,
  });

  // B2G
  const uShylaja = await mkUser({
    empId: "SFJ-R-11634",
    email: "ta7181@sfjbs.com",
    firstName: "Shylaja",
    lastName: "Pragash",
    roleId: roleDeliveryManager.id,
    deptId: deptB2GDelivery.id,
    phone: "9600207000",
  });

  const uSushanta = await mkUser({
    empId: "SFJ-R-11932",
    email: "am242@sfjbs.com",
    firstName: "Sushanta",
    lastName: "Chakraborty",
    roleId: roleSeniorCSM.id,
    deptId: deptB2GDelivery.id,
    phone: "7846871000",
  });

  const uAnanyaAR = await mkUser({
    empId: "bS-R-22053",
    email: "ins04@bskilling.com",
    firstName: "Ananya",
    lastName: "AR",
    roleId: roleCSM.id,
    deptId: deptB2GDelivery.id,
    phone: "9353146000",
  });

  console.log("  ✓ All users created\n");

  // ─────────────────────────────────────────────────────────────────────────
  // REPORTING LINES
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Wiring reporting lines...");

  const wire = async (userId: string, managerId: string, teamLeadId?: string) =>
    prisma.user.update({
      where: { id: userId },
      data: {
        reportingToId: managerId,
        ...(teamLeadId && { teamLeadId }),
      },
    });

  // reports to Siva
  await wire(uRakhi.id, uSiva.id);
  await wire(uYatin.id, uSiva.id);
  await wire(uSaijal.id, uSiva.id); // per hierarchy — Saijal reports to Siva directly
  await wire(uRoja.id, uSiva.id);
  await wire(uYesvanth.id, uSiva.id);
  await wire(uMadhavi.id, uSiva.id);
  await wire(uShylaja.id, uSiva.id);
  await wire(uSushanta.id, uSiva.id);

  // CSMs report to Rakhi
  await wire(uAjay.id, uRakhi.id);
  await wire(uAkash.id, uRakhi.id);
  await wire(uManishaJK.id, uRakhi.id);
  await wire(uRadha.id, uRakhi.id);
  await wire(uRitu.id, uRakhi.id);
  await wire(uSoma.id, uRakhi.id);

  // DMs report to Rakhi
  await wire(uPapitha.id, uRakhi.id);
  await wire(uSarala.id, uRakhi.id);

  // DL Likhitha reports to Papitha, teamLead = Papitha
  await wire(uLikhitha.id, uPapitha.id);

  // Recruiters under Likhitha — reportTo = Papitha, teamLead = Likhitha
  await wire(uLathika.id, uPapitha.id, uLikhitha.id);
  await wire(uMPooja.id, uPapitha.id, uLikhitha.id);
  await wire(uNeha.id, uPapitha.id, uLikhitha.id);
  await wire(uPriyanka.id, uPapitha.id, uLikhitha.id);
  await wire(uSowndhary.id, uPapitha.id, uLikhitha.id);

  // Recruiters under Sarala — reportTo = Rakhi, teamLead = Sarala
  await wire(uGeethika.id, uRakhi.id, uSarala.id);
  await wire(uRamLaksh.id, uRakhi.id, uSarala.id);
  await wire(uSamiksh.id, uRakhi.id, uSarala.id);

  // DL Karthikeyan reports to Saijal
  await wire(uKarthDM.id, uSaijal.id);

  // Recruiters under Karthikeyan — reportTo = Saijal, teamLead = Karthikeyan
  await wire(uAbhilash.id, uSaijal.id, uKarthDM.id);
  await wire(uMunaff.id, uSaijal.id, uKarthDM.id);
  await wire(uRaviPT.id, uSaijal.id, uKarthDM.id);
  await wire(uSibbala.id, uSaijal.id, uKarthDM.id);
  await wire(uTejash.id, uSaijal.id, uKarthDM.id);

  // TaaS Roja's team — direct reports
  await wire(uAkkala.id, uRoja.id);
  await wire(uBhushan.id, uRoja.id);
  await wire(uLatha.id, uRoja.id);
  await wire(uDJamuna.id, uRoja.id);
  await wire(uDanam.id, uRoja.id);
  await wire(uJyothi.id, uRoja.id);
  await wire(uMeenaksh.id, uRoja.id);
  await wire(uPavan.id, uRoja.id);

  // TaaS Yesvanth's DLs
  await wire(uDeivan.id, uYesvanth.id);
  await wire(uSubhasre.id, uYesvanth.id);

  // Deivanai's team — reportTo = Yesvanth, teamLead = Deivanai
  await wire(uRajat.id, uYesvanth.id, uDeivan.id);
  await wire(uSangeetha.id, uYesvanth.id, uDeivan.id);
  await wire(uSubhasmi.id, uYesvanth.id, uDeivan.id);
  await wire(uVasanth.id, uYesvanth.id, uDeivan.id);
  await wire(uVemula.id, uYesvanth.id, uDeivan.id);

  // Subhasree's team — reportTo = Yesvanth, teamLead = Subhasree
  await wire(uKoduru.id, uYesvanth.id, uSubhasre.id);
  await wire(uPayal.id, uYesvanth.id, uSubhasre.id);
  await wire(uAishw.id, uYesvanth.id, uSubhasre.id);

  // Internal hiring — Madhavi's team
  await wire(uMenka.id, uMadhavi.id);
  await wire(uVyshnavi.id, uMadhavi.id);
  await wire(uDhanesh.id, uMadhavi.id);
  await wire(uAqeeb.id, uMadhavi.id);
  await wire(uHemaKB.id, uMadhavi.id);
  await wire(uAnshita.id, uMadhavi.id);
  await wire(uTanuja.id, uMadhavi.id);

  // B2G
  await wire(uAnanyaAR.id, uSushanta.id);

  console.log("  ✓ Reporting lines wired\n");

  // ─────────────────────────────────────────────────────────────────────────
  // CLIENTS + SPOCS
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding clients + spocs...");

  const mkClient = async (data: {
    name: string;
    industry: string;
    country: string;
    city: string;
    buId: string;
    createdById: string;
    approvedById: string;
  }) =>
    prisma.client.upsert({
      where: { id: `client-${data.name.toLowerCase().replace(/\s/g, "-")}` },
      update: {},
      create: {
        id: `client-${data.name.toLowerCase().replace(/\s/g, "-")}`,
        name: data.name,
        industry: data.industry,
        country: data.country,
        city: data.city,
        status: "ACTIVE",
        businessUnitId: data.buId,
        createdById: data.createdById,
        approvedById: data.approvedById,
        approvedAt: new Date(),
      },
    });

  const clientCapgemini = await mkClient({
    name: "Capgemini",
    industry: "IT Services",
    country: "India",
    city: "Bangalore",
    buId: buEnterpriseIT.id,
    createdById: uRoja.id,
    approvedById: uSiva.id,
  });

  const clientCTS = await mkClient({
    name: "Cognizant",
    industry: "IT Services",
    country: "India",
    city: "Chennai",
    buId: buEnterpriseIT.id,
    createdById: uLikhitha.id,
    approvedById: uSiva.id,
  });

  const clientNM = await mkClient({
    name: "Naan Mudhalvan",
    industry: "Education / Skilling",
    country: "India",
    city: "Chennai",
    buId: buB2GSkilling.id,
    createdById: uShylaja.id,
    approvedById: uSiva.id,
  });

  const clientTCS = await mkClient({
    name: "TCS",
    industry: "IT Services",
    country: "India",
    city: "Mumbai",
    buId: buEnterpriseIT.id,
    createdById: uSarala.id,
    approvedById: uSiva.id,
  });

  // spocs
  const mkSpoc = async (
    clientId: string,
    userId: string,
    slId: string,
    buId: string,
    isPrimary = true
  ) =>
    prisma.clientSpoc.upsert({
      where: {
        clientId_userId_serviceLineId: {
          clientId,
          userId,
          serviceLineId: slId,
        },
      },
      update: {},
      create: {
        clientId,
        userId,
        serviceLineId: slId,
        businessUnitId: buId,
        isPrimary,
        isActive: true,
        assignedById: uSiva.id,
      },
    });

  await mkSpoc(
    clientCapgemini.id,
    uRoja.id,
    slTaaS.id,
    buEnterpriseIT.id,
    true
  );
  await mkSpoc(
    clientCapgemini.id,
    uAjay.id,
    slKaaS.id,
    buEnterpriseIT.id,
    false
  );
  await mkSpoc(clientCTS.id, uLikhitha.id, slKaaS.id, buEnterpriseIT.id, true);
  await mkSpoc(clientCTS.id, uSarala.id, slKaaS.id, buEnterpriseIT.id, false);
  await mkSpoc(clientNM.id, uShylaja.id, slTaaS.id, buB2GSkilling.id, true);
  await mkSpoc(clientNM.id, uAnanyaAR.id, slKaaS.id, buB2GSkilling.id, false);
  await mkSpoc(clientTCS.id, uSarala.id, slKaaS.id, buEnterpriseIT.id, true);

  console.log("  ✓ 4 clients + spocs seeded\n");

  // ─────────────────────────────────────────────────────────────────────────
  // REQUIREMENTS
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding requirements...");

  const spocCapRoja = await prisma.clientSpoc.findFirst({
    where: { clientId: clientCapgemini.id, userId: uRoja.id },
  });
  const spocCTSLiki = await prisma.clientSpoc.findFirst({
    where: { clientId: clientCTS.id, userId: uLikhitha.id },
  });
  const spocNMShylaja = await prisma.clientSpoc.findFirst({
    where: { clientId: clientNM.id, userId: uShylaja.id },
  });
  const spocTCSSarala = await prisma.clientSpoc.findFirst({
    where: { clientId: clientTCS.id, userId: uSarala.id },
  });

  const mkReq = async (opts: {
    code: string;
    title: string;
    spocId: string;
    clientId: string;
    buId: string;
    slId: string;
    jobType: string;
    remoteType: string;
    priority: string;
    status: string;
    openings: number;
    expMin: number;
    expMax: number;
    salMin: number;
    salMax: number;
    location: string;
    createdById: string;
    approvedById?: string;
    skills: string[];
  }) =>
    prisma.requirement.upsert({
      where: { reqCode: opts.code },
      update: {},
      create: {
        reqCode: opts.code,
        title: opts.title,
        clientSpocId: opts.spocId,
        clientId: opts.clientId,
        businessUnitId: opts.buId,
        serviceLineId: opts.slId,
        jobType: opts.jobType as any,
        remoteType: opts.remoteType as any,
        priority: opts.priority as any,
        status: opts.status as any,
        totalOpenings: opts.openings,
        experienceMin: opts.expMin,
        experienceMax: opts.expMax,
        salaryMin: opts.salMin,
        salaryMax: opts.salMax,
        salaryType: "MONTHLY" as any,
        location: opts.location,
        country: "India",
        skills: opts.skills,
        createdById: opts.createdById,
        approvedById: opts.approvedById ?? null,
        approvedAt: opts.approvedById ? new Date() : null,
        respondBy: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });

  const req1 = await mkReq({
    code: "REQ-2025-0001",
    title: "Senior Java Developer",
    spocId: spocCapRoja!.id,
    clientId: clientCapgemini.id,
    buId: buEnterpriseIT.id,
    slId: slTaaS.id,
    jobType: "CONTRACT",
    remoteType: "HYBRID",
    priority: "HIGH",
    status: "ACTIVE",
    openings: 3,
    expMin: 5,
    expMax: 10,
    salMin: 120000,
    salMax: 160000,
    location: "Bangalore",
    createdById: uRoja.id,
    approvedById: uSiva.id,
    skills: ["Java", "Spring Boot", "Microservices", "AWS"],
  });

  const req2 = await mkReq({
    code: "REQ-2025-0002",
    title: "Sr. React Developer",
    spocId: spocCTSLiki!.id,
    clientId: clientCTS.id,
    buId: buEnterpriseIT.id,
    slId: slKaaS.id,
    jobType: "PERMANENT",
    remoteType: "HYBRID",
    priority: "HIGH",
    status: "ACTIVE",
    openings: 2,
    expMin: 4,
    expMax: 8,
    salMin: 90000,
    salMax: 130000,
    location: "Chennai",
    createdById: uLikhitha.id,
    approvedById: uRakhi.id,
    skills: ["React", "TypeScript", "Redux", "Node.js"],
  });

  const req3 = await mkReq({
    code: "REQ-2025-0003",
    title: "AWS Cloud Trainer",
    spocId: spocNMShylaja!.id,
    clientId: clientNM.id,
    buId: buB2GSkilling.id,
    slId: slTaaS.id,
    jobType: "CONTRACT",
    remoteType: "ONSITE",
    priority: "HIGH",
    status: "ACTIVE",
    openings: 4,
    expMin: 2,
    expMax: 5,
    salMin: 60000,
    salMax: 80000,
    location: "Chennai",
    createdById: uShylaja.id,
    approvedById: uSiva.id,
    skills: ["AWS", "Cloud", "Training", "Certification"],
  });

  const req4 = await mkReq({
    code: "REQ-2025-0004",
    title: "SAP FICO Consultant",
    spocId: spocTCSSarala!.id,
    clientId: clientTCS.id,
    buId: buEnterpriseIT.id,
    slId: slKaaS.id,
    jobType: "CONTRACT",
    remoteType: "ONSITE",
    priority: "MEDIUM",
    status: "PENDING_APPROVAL",
    openings: 1,
    expMin: 6,
    expMax: 12,
    salMin: 130000,
    salMax: 180000,
    location: "Mumbai",
    createdById: uSarala.id,
    skills: ["SAP", "FICO", "Finance", "Controlling"],
  });

  const req5 = await mkReq({
    code: "REQ-2025-0005",
    title: "DevOps Engineer",
    spocId: spocCapRoja!.id,
    clientId: clientCapgemini.id,
    buId: buEnterpriseIT.id,
    slId: slTaaS.id,
    jobType: "CONTRACT",
    remoteType: "REMOTE",
    priority: "HIGH",
    status: "DRAFT",
    openings: 2,
    expMin: 3,
    expMax: 7,
    salMin: 100000,
    salMax: 140000,
    location: "Hyderabad",
    createdById: uRoja.id,
    skills: ["DevOps", "Docker", "Kubernetes", "CI/CD"],
  });

  console.log("  ✓ 5 requirements seeded\n");

  // ─────────────────────────────────────────────────────────────────────────
  // ASSIGNMENTS
  // depth 0 = manager assigned by sales/spoc
  // depth 1 = DM assigns to DL
  // depth 2 = DL assigns to recruiter
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding assignments...");

  const mkAssign = async (opts: {
    reqId: string;
    assignedToId: string;
    assignedById: string;
    depth: number;
    parentId?: string;
    deptId?: string;
    clientId?: string;
    allocatedOpenings?: number;
  }) =>
    prisma.requirementAssignment.create({
      data: {
        requirementId: opts.reqId,
        assignedToId: opts.assignedToId,
        assignedById: opts.assignedById,
        depth: opts.depth,
        parentAssignmentId: opts.parentId ?? null,
        assigneeDepartmentId: opts.deptId ?? null,
        clientId: opts.clientId ?? null,
        allocatedOpenings: opts.allocatedOpenings ?? null,
        status: "ACTIVE",
      },
    });

  // REQ-0001 — Senior Java Dev at Capgemini
  // Roja (DM) assigned by Siva → depth 0
  const a1_dm = await mkAssign({
    reqId: req1.id,
    assignedToId: uRoja.id,
    assignedById: uSiva.id,
    depth: 0,
    deptId: deptTaaSDelivery.id,
    clientId: clientCapgemini.id,
    allocatedOpenings: 3,
  });
  // Latha (recruiter) assigned by Roja → depth 1
  await mkAssign({
    reqId: req1.id,
    assignedToId: uLatha.id,
    assignedById: uRoja.id,
    depth: 1,
    parentId: a1_dm.id,
    deptId: deptTaaSDelivery.id,
    clientId: clientCapgemini.id,
    allocatedOpenings: 2,
  });
  // Akkala (recruiter) assigned by Roja → depth 1
  await mkAssign({
    reqId: req1.id,
    assignedToId: uAkkala.id,
    assignedById: uRoja.id,
    depth: 1,
    parentId: a1_dm.id,
    deptId: deptTaaSDelivery.id,
    clientId: clientCapgemini.id,
    allocatedOpenings: 1,
  });

  // REQ-0002 — Sr React Dev at CTS
  // Papitha (DM) assigned by Rakhi → depth 0
  const a2_dm = await mkAssign({
    reqId: req2.id,
    assignedToId: uPapitha.id,
    assignedById: uRakhi.id,
    depth: 0,
    deptId: deptKaaSDelivery.id,
    clientId: clientCTS.id,
    allocatedOpenings: 2,
  });
  // Likhitha (DL) assigned by Papitha → depth 1
  const a2_dl = await mkAssign({
    reqId: req2.id,
    assignedToId: uLikhitha.id,
    assignedById: uPapitha.id,
    depth: 1,
    parentId: a2_dm.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientCTS.id,
    allocatedOpenings: 2,
  });
  // M Pooja (recruiter) assigned by Likhitha → depth 2
  await mkAssign({
    reqId: req2.id,
    assignedToId: uMPooja.id,
    assignedById: uLikhitha.id,
    depth: 2,
    parentId: a2_dl.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientCTS.id,
    allocatedOpenings: 1,
  });
  // Neha (recruiter) assigned by Likhitha → depth 2
  await mkAssign({
    reqId: req2.id,
    assignedToId: uNeha.id,
    assignedById: uLikhitha.id,
    depth: 2,
    parentId: a2_dl.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientCTS.id,
    allocatedOpenings: 1,
  });

  // REQ-0003 — AWS Cloud Trainer at NM
  // Shylaja (DM) assigned by Siva → depth 0
  const a3_dm = await mkAssign({
    reqId: req3.id,
    assignedToId: uShylaja.id,
    assignedById: uSiva.id,
    depth: 0,
    deptId: deptB2GDelivery.id,
    clientId: clientNM.id,
    allocatedOpenings: 4,
  });

  console.log("  ✓ Assignments seeded\n");

  // ─────────────────────────────────────────────────────────────────────────
  // CANDIDATE SNAPSHOTS
  // ─────────────────────────────────────────────────────────────────────────
  console.log("▶ Seeding candidate snapshots...");

  const candidates = [
    {
      reqId: req1.id,
      candidateId: "cand-ext-001",
      name: "Arjun Sharma",
      email: "arjun.sharma@gmail.com",
      stage: "INTERVIEW_SCHEDULED",
    },
    {
      reqId: req1.id,
      candidateId: "cand-ext-002",
      name: "Priya Nair",
      email: "priya.nair@gmail.com",
      stage: "SUBMITTED",
    },
    {
      reqId: req1.id,
      candidateId: "cand-ext-003",
      name: "Rahul Gupta",
      email: "rahul.gupta@gmail.com",
      stage: "SCREENING",
    },
    {
      reqId: req2.id,
      candidateId: "cand-ext-004",
      name: "Sneha Iyer",
      email: "sneha.iyer@gmail.com",
      stage: "OFFER_ROLLED",
    },
    {
      reqId: req2.id,
      candidateId: "cand-ext-005",
      name: "Karan Patel",
      email: "karan.patel@gmail.com",
      stage: "INTERVIEW_DONE",
    },
    {
      reqId: req3.id,
      candidateId: "cand-ext-006",
      name: "Divya Menon",
      email: "divya.menon@gmail.com",
      stage: "SOURCED",
    },
    {
      reqId: req3.id,
      candidateId: "cand-ext-007",
      name: "Arun Kumar",
      email: "arun.kumar@gmail.com",
      stage: "SCREENING",
    },
  ];

  for (const c of candidates) {
    await prisma.requirementCandidate.upsert({
      where: {
        requirementId_candidateId: {
          requirementId: c.reqId,
          candidateId: c.candidateId,
        },
      },
      update: {},
      create: {
        requirementId: c.reqId,
        candidateId: c.candidateId,
        candidateName: c.name,
        candidateEmail: c.email,
        currentStage: c.stage as any,
      },
    });
  }

  // bump counters on req1
  await prisma.requirement.update({
    where: { id: req1.id },
    data: { activeApplications: 3, interviewsScheduled: 1 },
  });
  await prisma.requirement.update({
    where: { id: req2.id },
    data: { activeApplications: 2, offersRolledOut: 1 },
  });

  console.log("  ✓ Candidate snapshots seeded\n");

  // ─────────────────────────────────────────────────────────────────────────
  // DONE
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
    "║  SAMPLE LOGINS              password: pass@123                   ║"
  );
  console.log(
    "║  Senior CSM  : rakhi.d@sfjbs.com                                ║"
  );
  console.log(
    "║  Senior CSM  : anand.y@sfjbs.com       (Yatin Anand)            ║"
  );
  console.log(
    "║  DM (KaaS)   : saijal.s@sfjbs.com                               ║"
  );
  console.log(
    "║  DM (TaaS)   : ta104@sfjbs.com          (Roja)                  ║"
  );
  console.log(
    "║  DM (TaaS)   : yesvanth@sfjbs.com                               ║"
  );
  console.log(
    "║  DM (B2G)    : ta7181@sfjbs.com         (Shylaja)               ║"
  );
  console.log(
    "║  DL (KaaS)   : ta7009@sfjbs.com         (Likhitha)              ║"
  );
  console.log(
    "║  DL (KaaS)   : ta123@sfjbs.com          (Karthikeyan)           ║"
  );
  console.log(
    "║  Recruiter   : ta7002@sfjbs.com         (Lathika)               ║"
  );
  console.log(
    "║  HR          : hr@sfjbs.com             (Madhavi)               ║"
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
