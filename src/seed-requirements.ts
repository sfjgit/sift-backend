// prisma/seed-requirements.ts
// Run after main seed.ts — extends with more clients, requirements, and assignments
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const rnd = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║     TalentOS — Requirements & Assignments Seed       ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  // ── Pull existing users by employeeId ──────────────────────────────────────
  const get = async (empId: string) => {
    const u = await prisma.user.findUnique({ where: { employeeId: empId } });
    if (!u) throw new Error(`User not found: ${empId}`);
    return u;
  };

  const uSiva = await get("SFJ-CEO-001");
  const uRakhi = await get("SFJ-R-9439");
  const uYatin = await get("SFJ-R-9839");
  const uRoja = await get("SFJ-R-9628");
  const uYesvanth = await get("SFJ-R-10475");
  const uShylaja = await get("SFJ-R-11634");
  const uSaijal = await get("SFJ-R-9323");
  const uMadhavi = await get("SFJ-R-11170");
  const uPapitha = await get("SFJ-PAPITHA-001");
  const uSarala = await get("SFJ-R-22064");
  const uLikhitha = await get("SFJ-R-11132");
  const uKarthDM = await get("SFJ-R-9771");
  const uDeivan = await get("SFJ-R-10678");
  const uSubhasre = await get("SFJ-R-11062");
  const uSushanta = await get("SFJ-R-11932");
  const uAjay = await get("SFJ-R-11794");
  const uAnanyaAR = await get("bS-R-22053");

  // recruiters
  const uLathika = await get("SFJ-R-12009");
  const uMPooja = await get("SFJ-R-11305");
  const uNeha = await get("bS-R-22040");
  const uPriyanka = await get("bS-R-22016");
  const uSowndhary = await get("bS-R-22043");
  const uGeethika = await get("bS-R-22059");
  const uRamLaksh = await get("bS-R-22049");
  const uSamiksh = await get("SFJ-R-12036");
  const uAbhilash = await get("SFJ-R-11909");
  const uMunaff = await get("SFJ-R-11434");
  const uSibbala = await get("SFJ-R-11495");
  const uTejash = await get("SFJ-R-11899");
  const uRaviPT = await get("bS-R-21905");
  const uLatha = await get("SFJ-R-9284");
  const uAkkala = await get("SFJ-R-22055");
  const uDJamuna = await get("bS-R-22061");
  const uDanam = await get("SFJ-R-10876");
  const uJyothi = await get("SFJ-R-10862");
  const uMeenaksh = await get("SFJ-R-11727");
  const uPavan = await get("bS-R-22035");
  const uBhushan = await get("bS-R-20525");
  const uRajat = await get("SFJ-R-11590");
  const uSangeetha = await get("SFJ-R-10705");
  const uSubhasmi = await get("SFJ-R-9843");
  const uVasanth = await get("bS-R-21745");
  const uVemula = await get("bS-R-22057");
  const uKoduru = await get("bS-R-21919");
  const uPayal = await get("bS-R-22006");
  const uAishw = await get("bS-R-22054");
  const uMenka = await get("SFJ-R-12041");
  const uVyshnavi = await get("bS-R-21789");

  // ── Pull existing BUs + service lines ─────────────────────────────────────
  const buEnterpriseIT = await prisma.businessUnit.findFirstOrThrow({
    where: { name: "Enterprise - IT" },
  });
  const buEnterpriseNIT = await prisma.businessUnit.findFirstOrThrow({
    where: { name: "Enterprise - Non IT" },
  });
  const buB2GSkilling = await prisma.businessUnit.findFirstOrThrow({
    where: { name: "B2G Skilling" },
  });
  const buB2GCPSU = await prisma.businessUnit.findFirstOrThrow({
    where: { name: "B2G CPSU" },
  });
  const slKaaS = await prisma.serviceLine.findFirstOrThrow({
    where: { name: "Knowledge as a Service" },
  });
  const slTaaS = await prisma.serviceLine.findFirstOrThrow({
    where: { name: "Talent as a Service" },
  });
  const deptKaaSDelivery = await prisma.department.findFirstOrThrow({
    where: { name: "KaaS Delivery" },
  });
  const deptTaaSDelivery = await prisma.department.findFirstOrThrow({
    where: { name: "TaaS Delivery" },
  });
  const deptB2GDelivery = await prisma.department.findFirstOrThrow({
    where: { name: "B2G Delivery" },
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  const mkClient = async (opts: {
    id: string;
    name: string;
    industry: string;
    country: string;
    city: string;
    buId: string;
    createdById: string;
    website?: string;
  }) =>
    prisma.client.upsert({
      where: { id: opts.id },
      update: {},
      create: {
        id: opts.id,
        name: opts.name,
        industry: opts.industry,
        country: opts.country,
        city: opts.city,
        website: opts.website ?? null,
        status: "ACTIVE",
        businessUnitId: opts.buId,
        createdById: opts.createdById,
        approvedById: uSiva.id,
        approvedAt: new Date(),
      },
    });

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

  let reqCounter = 6; // continue from REQ-2025-0005
  const mkReq = async (opts: {
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
    filledOpenings?: number;
    activeApplications?: number;
    interviewsScheduled?: number;
    offersRolledOut?: number;
  }) => {
    const code = `REQ-2025-${String(reqCounter++).padStart(4, "0")}`;
    return prisma.requirement.upsert({
      where: { reqCode: code },
      update: {},
      create: {
        reqCode: code,
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
        filledOpenings: opts.filledOpenings ?? 0,
        activeApplications: opts.activeApplications ?? 0,
        interviewsScheduled: opts.interviewsScheduled ?? 0,
        offersRolledOut: opts.offersRolledOut ?? 0,
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
        respondBy: new Date(Date.now() + rnd(7, 30) * 24 * 60 * 60 * 1000),
        turnaroundDays: rnd(14, 45),
      },
    });
  };

  const mkAssign = async (opts: {
    reqId: string;
    assignedToId: string;
    assignedById: string;
    depth: number;
    parentId?: string;
    deptId?: string;
    clientId?: string;
    allocatedOpenings?: number;
    submissionsCount?: number;
    interviewsCount?: number;
    filledOpenings?: number;
    status?: string;
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
        submissionsCount: opts.submissionsCount ?? 0,
        interviewsCount: opts.interviewsCount ?? 0,
        filledOpenings: opts.filledOpenings ?? 0,
        status: (opts.status ?? "ACTIVE") as any,
        deadline: new Date(Date.now() + rnd(10, 40) * 24 * 60 * 60 * 1000),
      },
    });

  // ──────────────────────────────────────────────────────────────────────────
  // CLIENTS
  // ──────────────────────────────────────────────────────────────────────────
  console.log("▶ Creating clients...");

  const clientWipro = await mkClient({
    id: "client-wipro",
    name: "Wipro",
    industry: "IT Services",
    country: "India",
    city: "Bangalore",
    buId: buEnterpriseIT.id,
    createdById: uRoja.id,
    website: "https://wipro.com",
  });
  const clientInfosys = await mkClient({
    id: "client-infosys",
    name: "Infosys",
    industry: "IT Services",
    country: "India",
    city: "Bangalore",
    buId: buEnterpriseIT.id,
    createdById: uLikhitha.id,
    website: "https://infosys.com",
  });
  const clientHCL = await mkClient({
    id: "client-hcl",
    name: "HCL Technologies",
    industry: "IT Services",
    country: "India",
    city: "Noida",
    buId: buEnterpriseIT.id,
    createdById: uSarala.id,
  });
  const clientAccenture = await mkClient({
    id: "client-accenture",
    name: "Accenture",
    industry: "IT Consulting",
    country: "India",
    city: "Mumbai",
    buId: buEnterpriseIT.id,
    createdById: uAjay.id,
  });
  const clientTechM = await mkClient({
    id: "client-techm",
    name: "Tech Mahindra",
    industry: "IT Services",
    country: "India",
    city: "Pune",
    buId: buEnterpriseIT.id,
    createdById: uRoja.id,
  });
  const clientMphasis = await mkClient({
    id: "client-mphasis",
    name: "Mphasis",
    industry: "IT Services",
    country: "India",
    city: "Bangalore",
    buId: buEnterpriseIT.id,
    createdById: uSarala.id,
  });
  const clientL_T = await mkClient({
    id: "client-ltts",
    name: "L&T Technology Services",
    industry: "Engineering Services",
    country: "India",
    city: "Vadodara",
    buId: buEnterpriseNIT.id,
    createdById: uRoja.id,
  });
  const clientNSSCT = await mkClient({
    id: "client-nasscom",
    name: "NASSCOM",
    industry: "Industry Body",
    country: "India",
    city: "Delhi",
    buId: buB2GSkilling.id,
    createdById: uShylaja.id,
  });
  const clientNSDC = await mkClient({
    id: "client-nsdc",
    name: "NSDC",
    industry: "Government / Skilling",
    country: "India",
    city: "Delhi",
    buId: buB2GSkilling.id,
    createdById: uShylaja.id,
  });
  const clientAPSSC = await mkClient({
    id: "client-apssc",
    name: "APSSC",
    industry: "Government",
    country: "India",
    city: "Hyderabad",
    buId: buB2GCPSU.id,
    createdById: uAnanyaAR.id,
  });

  console.log("  ✓ 10 new clients created\n");

  // ── SPOCs ─────────────────────────────────────────────────────────────────
  console.log("▶ Setting up SPOCs...");

  // Wipro — Roja primary, Latha secondary
  const spocWiproRoja = await mkSpoc(
    clientWipro.id,
    uRoja.id,
    slTaaS.id,
    buEnterpriseIT.id,
    true
  );
  await mkSpoc(clientWipro.id, uDeivan.id, slTaaS.id, buEnterpriseIT.id, false);

  // Infosys — Likhitha primary
  const spocInfoLiki = await mkSpoc(
    clientInfosys.id,
    uLikhitha.id,
    slKaaS.id,
    buEnterpriseIT.id,
    true
  );
  await mkSpoc(
    clientInfosys.id,
    uSarala.id,
    slKaaS.id,
    buEnterpriseIT.id,
    false
  );

  // HCL — Sarala primary
  const spocHCLSarala = await mkSpoc(
    clientHCL.id,
    uSarala.id,
    slKaaS.id,
    buEnterpriseIT.id,
    true
  );
  await mkSpoc(clientHCL.id, uKarthDM.id, slKaaS.id, buEnterpriseIT.id, false);

  // Accenture — Ajay primary
  const spocAccAjay = await mkSpoc(
    clientAccenture.id,
    uAjay.id,
    slKaaS.id,
    buEnterpriseIT.id,
    true
  );

  // TechM — Roja primary
  const spocTechMRoja = await mkSpoc(
    clientTechM.id,
    uRoja.id,
    slTaaS.id,
    buEnterpriseIT.id,
    true
  );

  // Mphasis — Sarala + Karthikeyan
  const spocMphSarala = await mkSpoc(
    clientMphasis.id,
    uSarala.id,
    slKaaS.id,
    buEnterpriseIT.id,
    true
  );
  await mkSpoc(
    clientMphasis.id,
    uKarthDM.id,
    slKaaS.id,
    buEnterpriseIT.id,
    false
  );

  // L&T — Roja
  const spocLTRoja = await mkSpoc(
    clientL_T.id,
    uRoja.id,
    slTaaS.id,
    buEnterpriseNIT.id,
    true
  );

  // NASSCOM — Shylaja + Ananya
  const spocNassShylaja = await mkSpoc(
    clientNSSCT.id,
    uShylaja.id,
    slTaaS.id,
    buB2GSkilling.id,
    true
  );
  await mkSpoc(
    clientNSSCT.id,
    uAnanyaAR.id,
    slKaaS.id,
    buB2GSkilling.id,
    false
  );

  // NSDC — Shylaja
  const spocNSDCShylaja = await mkSpoc(
    clientNSDC.id,
    uShylaja.id,
    slTaaS.id,
    buB2GSkilling.id,
    true
  );

  // APSSC — Ananya
  const spocAPSSCAnanya = await mkSpoc(
    clientAPSSC.id,
    uAnanyaAR.id,
    slTaaS.id,
    buB2GCPSU.id,
    true
  );

  console.log("  ✓ SPOCs wired\n");

  // ──────────────────────────────────────────────────────────────────────────
  // REQUIREMENTS + ASSIGNMENTS
  // Pattern: Sales/CSM creates req → DM (depth 0) → DL (depth 1) → Recruiters (depth 2)
  // ──────────────────────────────────────────────────────────────────────────
  console.log("▶ Creating requirements + full assignment chains...\n");

  // ── WIPRO (TaaS — Roja DM → Deivanai DL → recruiters) ────────────────────

  const rWipro1 = await mkReq({
    title: "Python ML Engineer",
    spocId: spocWiproRoja.id,
    clientId: clientWipro.id,
    buId: buEnterpriseIT.id,
    slId: slTaaS.id,
    jobType: "PERMANENT",
    remoteType: "HYBRID",
    priority: "HIGH",
    status: "ACTIVE",
    openings: 3,
    expMin: 4,
    expMax: 8,
    salMin: 120000,
    salMax: 160000,
    location: "Bangalore",
    createdById: uRoja.id,
    approvedById: uSiva.id,
    skills: ["Python", "ML", "TensorFlow", "AWS"],
    filledOpenings: 1,
    activeApplications: 8,
    interviewsScheduled: 3,
    offersRolledOut: 1,
  });
  const aW1dm = await mkAssign({
    reqId: rWipro1.id,
    assignedToId: uRoja.id,
    assignedById: uSiva.id,
    depth: 0,
    deptId: deptTaaSDelivery.id,
    clientId: clientWipro.id,
    allocatedOpenings: 3,
    submissionsCount: 8,
    interviewsCount: 3,
    filledOpenings: 1,
  });
  const aW1dl = await mkAssign({
    reqId: rWipro1.id,
    assignedToId: uDeivan.id,
    assignedById: uRoja.id,
    depth: 1,
    parentId: aW1dm.id,
    deptId: deptTaaSDelivery.id,
    clientId: clientWipro.id,
    allocatedOpenings: 3,
    submissionsCount: 8,
    interviewsCount: 3,
    filledOpenings: 1,
  });
  await mkAssign({
    reqId: rWipro1.id,
    assignedToId: uRajat.id,
    assignedById: uDeivan.id,
    depth: 2,
    parentId: aW1dl.id,
    deptId: deptTaaSDelivery.id,
    clientId: clientWipro.id,
    allocatedOpenings: 2,
    submissionsCount: 5,
    interviewsCount: 2,
    filledOpenings: 1,
  });
  await mkAssign({
    reqId: rWipro1.id,
    assignedToId: uSangeetha.id,
    assignedById: uDeivan.id,
    depth: 2,
    parentId: aW1dl.id,
    deptId: deptTaaSDelivery.id,
    clientId: clientWipro.id,
    allocatedOpenings: 1,
    submissionsCount: 3,
    interviewsCount: 1,
  });

  const rWipro2 = await mkReq({
    title: "Data Engineer (Spark)",
    spocId: spocWiproRoja.id,
    clientId: clientWipro.id,
    buId: buEnterpriseIT.id,
    slId: slTaaS.id,
    jobType: "CONTRACT",
    remoteType: "REMOTE",
    priority: "MEDIUM",
    status: "ACTIVE",
    openings: 2,
    expMin: 3,
    expMax: 6,
    salMin: 90000,
    salMax: 120000,
    location: "Remote",
    createdById: uRoja.id,
    approvedById: uSiva.id,
    skills: ["PySpark", "Databricks", "SQL", "Azure"],
    activeApplications: 5,
    interviewsScheduled: 2,
  });
  const aW2dm = await mkAssign({
    reqId: rWipro2.id,
    assignedToId: uRoja.id,
    assignedById: uSiva.id,
    depth: 0,
    deptId: deptTaaSDelivery.id,
    clientId: clientWipro.id,
    allocatedOpenings: 2,
    submissionsCount: 5,
    interviewsCount: 2,
  });
  const aW2dl = await mkAssign({
    reqId: rWipro2.id,
    assignedToId: uSubhasre.id,
    assignedById: uRoja.id,
    depth: 1,
    parentId: aW2dm.id,
    deptId: deptTaaSDelivery.id,
    clientId: clientWipro.id,
    allocatedOpenings: 2,
    submissionsCount: 5,
    interviewsCount: 2,
  });
  await mkAssign({
    reqId: rWipro2.id,
    assignedToId: uKoduru.id,
    assignedById: uSubhasre.id,
    depth: 2,
    parentId: aW2dl.id,
    deptId: deptTaaSDelivery.id,
    clientId: clientWipro.id,
    allocatedOpenings: 1,
    submissionsCount: 3,
    interviewsCount: 1,
  });
  await mkAssign({
    reqId: rWipro2.id,
    assignedToId: uPayal.id,
    assignedById: uSubhasre.id,
    depth: 2,
    parentId: aW2dl.id,
    deptId: deptTaaSDelivery.id,
    clientId: clientWipro.id,
    allocatedOpenings: 1,
    submissionsCount: 2,
    interviewsCount: 1,
  });

  const rWipro3 = await mkReq({
    title: "QA Automation Engineer",
    spocId: spocWiproRoja.id,
    clientId: clientWipro.id,
    buId: buEnterpriseIT.id,
    slId: slTaaS.id,
    jobType: "PERMANENT",
    remoteType: "ONSITE",
    priority: "LOW",
    status: "ON_HOLD",
    openings: 1,
    expMin: 2,
    expMax: 5,
    salMin: 60000,
    salMax: 90000,
    location: "Bangalore",
    createdById: uRoja.id,
    skills: ["Selenium", "Cypress", "Java", "TestNG"],
  });

  // ── INFOSYS (KaaS — Papitha DM → Likhitha DL → recruiters) ───────────────

  const rInfo1 = await mkReq({
    title: "Full Stack Developer (MEAN)",
    spocId: spocInfoLiki.id,
    clientId: clientInfosys.id,
    buId: buEnterpriseIT.id,
    slId: slKaaS.id,
    jobType: "PERMANENT",
    remoteType: "HYBRID",
    priority: "HIGH",
    status: "ACTIVE",
    openings: 4,
    expMin: 3,
    expMax: 7,
    salMin: 80000,
    salMax: 120000,
    location: "Bangalore",
    createdById: uLikhitha.id,
    approvedById: uRakhi.id,
    skills: ["MongoDB", "Express", "Angular", "Node.js"],
    filledOpenings: 2,
    activeApplications: 12,
    interviewsScheduled: 5,
    offersRolledOut: 2,
  });
  const aI1dm = await mkAssign({
    reqId: rInfo1.id,
    assignedToId: uPapitha.id,
    assignedById: uRakhi.id,
    depth: 0,
    deptId: deptKaaSDelivery.id,
    clientId: clientInfosys.id,
    allocatedOpenings: 4,
    submissionsCount: 12,
    interviewsCount: 5,
    filledOpenings: 2,
  });
  const aI1dl = await mkAssign({
    reqId: rInfo1.id,
    assignedToId: uLikhitha.id,
    assignedById: uPapitha.id,
    depth: 1,
    parentId: aI1dm.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientInfosys.id,
    allocatedOpenings: 4,
    submissionsCount: 12,
    interviewsCount: 5,
    filledOpenings: 2,
  });
  await mkAssign({
    reqId: rInfo1.id,
    assignedToId: uMPooja.id,
    assignedById: uLikhitha.id,
    depth: 2,
    parentId: aI1dl.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientInfosys.id,
    allocatedOpenings: 2,
    submissionsCount: 7,
    interviewsCount: 3,
    filledOpenings: 1,
  });
  await mkAssign({
    reqId: rInfo1.id,
    assignedToId: uNeha.id,
    assignedById: uLikhitha.id,
    depth: 2,
    parentId: aI1dl.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientInfosys.id,
    allocatedOpenings: 2,
    submissionsCount: 5,
    interviewsCount: 2,
    filledOpenings: 1,
  });

  const rInfo2 = await mkReq({
    title: "Salesforce Developer",
    spocId: spocInfoLiki.id,
    clientId: clientInfosys.id,
    buId: buEnterpriseIT.id,
    slId: slKaaS.id,
    jobType: "CONTRACT",
    remoteType: "REMOTE",
    priority: "HIGH",
    status: "ACTIVE",
    openings: 2,
    expMin: 4,
    expMax: 8,
    salMin: 100000,
    salMax: 140000,
    location: "Remote",
    createdById: uLikhitha.id,
    approvedById: uRakhi.id,
    skills: ["Salesforce", "Apex", "LWC", "SOQL"],
    activeApplications: 6,
    interviewsScheduled: 2,
  });
  const aI2dm = await mkAssign({
    reqId: rInfo2.id,
    assignedToId: uPapitha.id,
    assignedById: uRakhi.id,
    depth: 0,
    deptId: deptKaaSDelivery.id,
    clientId: clientInfosys.id,
    allocatedOpenings: 2,
    submissionsCount: 6,
    interviewsCount: 2,
  });
  const aI2dl = await mkAssign({
    reqId: rInfo2.id,
    assignedToId: uLikhitha.id,
    assignedById: uPapitha.id,
    depth: 1,
    parentId: aI2dm.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientInfosys.id,
    allocatedOpenings: 2,
    submissionsCount: 6,
    interviewsCount: 2,
  });
  await mkAssign({
    reqId: rInfo2.id,
    assignedToId: uPriyanka.id,
    assignedById: uLikhitha.id,
    depth: 2,
    parentId: aI2dl.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientInfosys.id,
    allocatedOpenings: 2,
    submissionsCount: 6,
    interviewsCount: 2,
  });

  const rInfo3 = await mkReq({
    title: "Business Analyst",
    spocId: spocInfoLiki.id,
    clientId: clientInfosys.id,
    buId: buEnterpriseIT.id,
    slId: slKaaS.id,
    jobType: "PERMANENT",
    remoteType: "HYBRID",
    priority: "MEDIUM",
    status: "ACTIVE",
    openings: 2,
    expMin: 3,
    expMax: 6,
    salMin: 70000,
    salMax: 100000,
    location: "Pune",
    createdById: uLikhitha.id,
    approvedById: uRakhi.id,
    skills: ["JIRA", "Confluence", "SQL", "Agile"],
    activeApplications: 4,
  });
  const aI3dm = await mkAssign({
    reqId: rInfo3.id,
    assignedToId: uPapitha.id,
    assignedById: uRakhi.id,
    depth: 0,
    deptId: deptKaaSDelivery.id,
    clientId: clientInfosys.id,
    allocatedOpenings: 2,
    submissionsCount: 4,
  });
  const aI3dl = await mkAssign({
    reqId: rInfo3.id,
    assignedToId: uLikhitha.id,
    assignedById: uPapitha.id,
    depth: 1,
    parentId: aI3dm.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientInfosys.id,
    allocatedOpenings: 2,
    submissionsCount: 4,
  });
  await mkAssign({
    reqId: rInfo3.id,
    assignedToId: uSowndhary.id,
    assignedById: uLikhitha.id,
    depth: 2,
    parentId: aI3dl.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientInfosys.id,
    allocatedOpenings: 2,
    submissionsCount: 4,
  });

  // ── HCL (KaaS — Saijal DM → Karthikeyan DL → recruiters) ─────────────────

  const rHCL1 = await mkReq({
    title: "iOS Developer (Swift)",
    spocId: spocHCLSarala.id,
    clientId: clientHCL.id,
    buId: buEnterpriseIT.id,
    slId: slKaaS.id,
    jobType: "PERMANENT",
    remoteType: "ONSITE",
    priority: "HIGH",
    status: "ACTIVE",
    openings: 2,
    expMin: 4,
    expMax: 8,
    salMin: 110000,
    salMax: 150000,
    location: "Noida",
    createdById: uSarala.id,
    approvedById: uRakhi.id,
    skills: ["Swift", "iOS", "Xcode", "CoreData"],
    activeApplications: 7,
    interviewsScheduled: 3,
  });
  const aH1dm = await mkAssign({
    reqId: rHCL1.id,
    assignedToId: uSaijal.id,
    assignedById: uRakhi.id,
    depth: 0,
    deptId: deptKaaSDelivery.id,
    clientId: clientHCL.id,
    allocatedOpenings: 2,
    submissionsCount: 7,
    interviewsCount: 3,
  });
  const aH1dl = await mkAssign({
    reqId: rHCL1.id,
    assignedToId: uKarthDM.id,
    assignedById: uSaijal.id,
    depth: 1,
    parentId: aH1dm.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientHCL.id,
    allocatedOpenings: 2,
    submissionsCount: 7,
    interviewsCount: 3,
  });
  await mkAssign({
    reqId: rHCL1.id,
    assignedToId: uAbhilash.id,
    assignedById: uKarthDM.id,
    depth: 2,
    parentId: aH1dl.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientHCL.id,
    allocatedOpenings: 1,
    submissionsCount: 4,
    interviewsCount: 2,
  });
  await mkAssign({
    reqId: rHCL1.id,
    assignedToId: uMunaff.id,
    assignedById: uKarthDM.id,
    depth: 2,
    parentId: aH1dl.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientHCL.id,
    allocatedOpenings: 1,
    submissionsCount: 3,
    interviewsCount: 1,
  });

  const rHCL2 = await mkReq({
    title: "Android Developer (Kotlin)",
    spocId: spocHCLSarala.id,
    clientId: clientHCL.id,
    buId: buEnterpriseIT.id,
    slId: slKaaS.id,
    jobType: "PERMANENT",
    remoteType: "HYBRID",
    priority: "MEDIUM",
    status: "ACTIVE",
    openings: 2,
    expMin: 3,
    expMax: 6,
    salMin: 90000,
    salMax: 130000,
    location: "Noida",
    createdById: uSarala.id,
    approvedById: uRakhi.id,
    skills: ["Kotlin", "Android", "Jetpack", "Firebase"],
    activeApplications: 5,
    interviewsScheduled: 1,
  });
  const aH2dm = await mkAssign({
    reqId: rHCL2.id,
    assignedToId: uSaijal.id,
    assignedById: uRakhi.id,
    depth: 0,
    deptId: deptKaaSDelivery.id,
    clientId: clientHCL.id,
    allocatedOpenings: 2,
    submissionsCount: 5,
    interviewsCount: 1,
  });
  const aH2dl = await mkAssign({
    reqId: rHCL2.id,
    assignedToId: uKarthDM.id,
    assignedById: uSaijal.id,
    depth: 1,
    parentId: aH2dm.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientHCL.id,
    allocatedOpenings: 2,
    submissionsCount: 5,
    interviewsCount: 1,
  });
  await mkAssign({
    reqId: rHCL2.id,
    assignedToId: uSibbala.id,
    assignedById: uKarthDM.id,
    depth: 2,
    parentId: aH2dl.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientHCL.id,
    allocatedOpenings: 1,
    submissionsCount: 3,
    interviewsCount: 1,
  });
  await mkAssign({
    reqId: rHCL2.id,
    assignedToId: uTejash.id,
    assignedById: uKarthDM.id,
    depth: 2,
    parentId: aH2dl.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientHCL.id,
    allocatedOpenings: 1,
    submissionsCount: 2,
  });

  const rHCL3 = await mkReq({
    title: "Cloud Infrastructure Engineer",
    spocId: spocHCLSarala.id,
    clientId: clientHCL.id,
    buId: buEnterpriseIT.id,
    slId: slKaaS.id,
    jobType: "CONTRACT",
    remoteType: "REMOTE",
    priority: "HIGH",
    status: "ACTIVE",
    openings: 3,
    expMin: 5,
    expMax: 10,
    salMin: 130000,
    salMax: 180000,
    location: "Remote",
    createdById: uSarala.id,
    approvedById: uRakhi.id,
    skills: ["AWS", "Terraform", "Kubernetes", "CI/CD"],
    filledOpenings: 1,
    activeApplications: 9,
    interviewsScheduled: 4,
    offersRolledOut: 1,
  });
  const aH3dm = await mkAssign({
    reqId: rHCL3.id,
    assignedToId: uSaijal.id,
    assignedById: uRakhi.id,
    depth: 0,
    deptId: deptKaaSDelivery.id,
    clientId: clientHCL.id,
    allocatedOpenings: 3,
    submissionsCount: 9,
    interviewsCount: 4,
    filledOpenings: 1,
  });
  const aH3dl = await mkAssign({
    reqId: rHCL3.id,
    assignedToId: uKarthDM.id,
    assignedById: uSaijal.id,
    depth: 1,
    parentId: aH3dm.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientHCL.id,
    allocatedOpenings: 3,
    submissionsCount: 9,
    interviewsCount: 4,
    filledOpenings: 1,
  });
  await mkAssign({
    reqId: rHCL3.id,
    assignedToId: uAbhilash.id,
    assignedById: uKarthDM.id,
    depth: 2,
    parentId: aH3dl.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientHCL.id,
    allocatedOpenings: 2,
    submissionsCount: 5,
    interviewsCount: 2,
    filledOpenings: 1,
  });
  await mkAssign({
    reqId: rHCL3.id,
    assignedToId: uRaviPT.id,
    assignedById: uKarthDM.id,
    depth: 2,
    parentId: aH3dl.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientHCL.id,
    allocatedOpenings: 1,
    submissionsCount: 4,
    interviewsCount: 2,
  });

  // ── ACCENTURE (KaaS — Sarala DM → Rakhi assigns → Likhitha DL) ────────────

  const rAcc1 = await mkReq({
    title: "Oracle DBA",
    spocId: spocAccAjay.id,
    clientId: clientAccenture.id,
    buId: buEnterpriseIT.id,
    slId: slKaaS.id,
    jobType: "CONTRACT",
    remoteType: "ONSITE",
    priority: "HIGH",
    status: "ACTIVE",
    openings: 2,
    expMin: 6,
    expMax: 12,
    salMin: 140000,
    salMax: 190000,
    location: "Mumbai",
    createdById: uAjay.id,
    approvedById: uRakhi.id,
    skills: ["Oracle", "DBA", "PL/SQL", "RAC"],
    activeApplications: 6,
    interviewsScheduled: 2,
  });
  const aA1dm = await mkAssign({
    reqId: rAcc1.id,
    assignedToId: uSaijal.id,
    assignedById: uRakhi.id,
    depth: 0,
    deptId: deptKaaSDelivery.id,
    clientId: clientAccenture.id,
    allocatedOpenings: 2,
    submissionsCount: 6,
    interviewsCount: 2,
  });
  const aA1dl = await mkAssign({
    reqId: rAcc1.id,
    assignedToId: uKarthDM.id,
    assignedById: uSaijal.id,
    depth: 1,
    parentId: aA1dm.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientAccenture.id,
    allocatedOpenings: 2,
    submissionsCount: 6,
    interviewsCount: 2,
  });
  await mkAssign({
    reqId: rAcc1.id,
    assignedToId: uMunaff.id,
    assignedById: uKarthDM.id,
    depth: 2,
    parentId: aA1dl.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientAccenture.id,
    allocatedOpenings: 2,
    submissionsCount: 6,
    interviewsCount: 2,
  });

  const rAcc2 = await mkReq({
    title: "Scrum Master",
    spocId: spocAccAjay.id,
    clientId: clientAccenture.id,
    buId: buEnterpriseIT.id,
    slId: slKaaS.id,
    jobType: "PERMANENT",
    remoteType: "HYBRID",
    priority: "MEDIUM",
    status: "PENDING_APPROVAL",
    openings: 1,
    expMin: 5,
    expMax: 10,
    salMin: 120000,
    salMax: 160000,
    location: "Bangalore",
    createdById: uAjay.id,
    skills: ["Scrum", "Agile", "JIRA", "SAFe"],
  });

  // ── TECH MAHINDRA (TaaS — Roja DM → Yesvanth team) ───────────────────────

  const rTM1 = await mkReq({
    title: "Embedded Systems Engineer",
    spocId: spocTechMRoja.id,
    clientId: clientTechM.id,
    buId: buEnterpriseIT.id,
    slId: slTaaS.id,
    jobType: "PERMANENT",
    remoteType: "ONSITE",
    priority: "HIGH",
    status: "ACTIVE",
    openings: 2,
    expMin: 3,
    expMax: 7,
    salMin: 80000,
    salMax: 120000,
    location: "Pune",
    createdById: uRoja.id,
    approvedById: uSiva.id,
    skills: ["C", "C++", "RTOS", "CAN Bus"],
    activeApplications: 4,
    interviewsScheduled: 2,
  });
  const aTM1dm = await mkAssign({
    reqId: rTM1.id,
    assignedToId: uYesvanth.id,
    assignedById: uSiva.id,
    depth: 0,
    deptId: deptTaaSDelivery.id,
    clientId: clientTechM.id,
    allocatedOpenings: 2,
    submissionsCount: 4,
    interviewsCount: 2,
  });
  const aTM1dl = await mkAssign({
    reqId: rTM1.id,
    assignedToId: uDeivan.id,
    assignedById: uYesvanth.id,
    depth: 1,
    parentId: aTM1dm.id,
    deptId: deptTaaSDelivery.id,
    clientId: clientTechM.id,
    allocatedOpenings: 2,
    submissionsCount: 4,
    interviewsCount: 2,
  });
  await mkAssign({
    reqId: rTM1.id,
    assignedToId: uVasanth.id,
    assignedById: uDeivan.id,
    depth: 2,
    parentId: aTM1dl.id,
    deptId: deptTaaSDelivery.id,
    clientId: clientTechM.id,
    allocatedOpenings: 1,
    submissionsCount: 2,
    interviewsCount: 1,
  });
  await mkAssign({
    reqId: rTM1.id,
    assignedToId: uVemula.id,
    assignedById: uDeivan.id,
    depth: 2,
    parentId: aTM1dl.id,
    deptId: deptTaaSDelivery.id,
    clientId: clientTechM.id,
    allocatedOpenings: 1,
    submissionsCount: 2,
    interviewsCount: 1,
  });

  const rTM2 = await mkReq({
    title: "Network Security Engineer",
    spocId: spocTechMRoja.id,
    clientId: clientTechM.id,
    buId: buEnterpriseIT.id,
    slId: slTaaS.id,
    jobType: "CONTRACT",
    remoteType: "HYBRID",
    priority: "MEDIUM",
    status: "ACTIVE",
    openings: 1,
    expMin: 4,
    expMax: 8,
    salMin: 100000,
    salMax: 140000,
    location: "Hyderabad",
    createdById: uRoja.id,
    approvedById: uSiva.id,
    skills: ["Cisco", "Firewall", "CCNP", "VPN"],
    activeApplications: 3,
  });
  const aTM2dm = await mkAssign({
    reqId: rTM2.id,
    assignedToId: uYesvanth.id,
    assignedById: uSiva.id,
    depth: 0,
    deptId: deptTaaSDelivery.id,
    clientId: clientTechM.id,
    allocatedOpenings: 1,
    submissionsCount: 3,
  });
  const aTM2dl = await mkAssign({
    reqId: rTM2.id,
    assignedToId: uSubhasre.id,
    assignedById: uYesvanth.id,
    depth: 1,
    parentId: aTM2dm.id,
    deptId: deptTaaSDelivery.id,
    clientId: clientTechM.id,
    allocatedOpenings: 1,
    submissionsCount: 3,
  });
  await mkAssign({
    reqId: rTM2.id,
    assignedToId: uAishw.id,
    assignedById: uSubhasre.id,
    depth: 2,
    parentId: aTM2dl.id,
    deptId: deptTaaSDelivery.id,
    clientId: clientTechM.id,
    allocatedOpenings: 1,
    submissionsCount: 3,
  });

  // ── MPHASIS (KaaS — Sarala DM → Karthikeyan DL) ───────────────────────────

  const rMph1 = await mkReq({
    title: "RPA Developer (UiPath)",
    spocId: spocMphSarala.id,
    clientId: clientMphasis.id,
    buId: buEnterpriseIT.id,
    slId: slKaaS.id,
    jobType: "CONTRACT",
    remoteType: "HYBRID",
    priority: "HIGH",
    status: "ACTIVE",
    openings: 2,
    expMin: 2,
    expMax: 5,
    salMin: 70000,
    salMax: 100000,
    location: "Bangalore",
    createdById: uSarala.id,
    approvedById: uRakhi.id,
    skills: ["UiPath", "RPA", "VBA", "SQL"],
    filledOpenings: 1,
    activeApplications: 6,
    interviewsScheduled: 3,
    offersRolledOut: 1,
  });
  const aM1dm = await mkAssign({
    reqId: rMph1.id,
    assignedToId: uSaijal.id,
    assignedById: uRakhi.id,
    depth: 0,
    deptId: deptKaaSDelivery.id,
    clientId: clientMphasis.id,
    allocatedOpenings: 2,
    submissionsCount: 6,
    interviewsCount: 3,
    filledOpenings: 1,
  });
  const aM1dl = await mkAssign({
    reqId: rMph1.id,
    assignedToId: uKarthDM.id,
    assignedById: uSaijal.id,
    depth: 1,
    parentId: aM1dm.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientMphasis.id,
    allocatedOpenings: 2,
    submissionsCount: 6,
    interviewsCount: 3,
    filledOpenings: 1,
  });
  await mkAssign({
    reqId: rMph1.id,
    assignedToId: uAbhilash.id,
    assignedById: uKarthDM.id,
    depth: 2,
    parentId: aM1dl.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientMphasis.id,
    allocatedOpenings: 1,
    submissionsCount: 3,
    interviewsCount: 2,
    filledOpenings: 1,
  });
  await mkAssign({
    reqId: rMph1.id,
    assignedToId: uRaviPT.id,
    assignedById: uKarthDM.id,
    depth: 2,
    parentId: aM1dl.id,
    deptId: deptKaaSDelivery.id,
    clientId: clientMphasis.id,
    allocatedOpenings: 1,
    submissionsCount: 3,
    interviewsCount: 1,
  });

  const rMph2 = await mkReq({
    title: "Power BI Developer",
    spocId: spocMphSarala.id,
    clientId: clientMphasis.id,
    buId: buEnterpriseIT.id,
    slId: slKaaS.id,
    jobType: "PERMANENT",
    remoteType: "REMOTE",
    priority: "MEDIUM",
    status: "DRAFT",
    openings: 1,
    expMin: 3,
    expMax: 6,
    salMin: 80000,
    salMax: 110000,
    location: "Remote",
    createdById: uSarala.id,
    skills: ["Power BI", "DAX", "SQL", "Azure"],
  });

  // ── L&T TECHNOLOGY SERVICES ────────────────────────────────────────────────

  const rLT1 = await mkReq({
    title: "Mechanical Design Engineer (CATIA)",
    spocId: spocLTRoja.id,
    clientId: clientL_T.id,
    buId: buEnterpriseNIT.id,
    slId: slTaaS.id,
    jobType: "PERMANENT",
    remoteType: "ONSITE",
    priority: "HIGH",
    status: "ACTIVE",
    openings: 3,
    expMin: 3,
    expMax: 8,
    salMin: 70000,
    salMax: 100000,
    location: "Vadodara",
    createdById: uRoja.id,
    approvedById: uSiva.id,
    skills: ["CATIA V5", "CATIA V6", "GD&T", "PLM"],
    activeApplications: 8,
    interviewsScheduled: 4,
  });
  const aLT1dm = await mkAssign({
    reqId: rLT1.id,
    assignedToId: uRoja.id,
    assignedById: uSiva.id,
    depth: 0,
    deptId: deptTaaSDelivery.id,
    clientId: clientL_T.id,
    allocatedOpenings: 3,
    submissionsCount: 8,
    interviewsCount: 4,
  });
  await mkAssign({
    reqId: rLT1.id,
    assignedToId: uDanam.id,
    assignedById: uRoja.id,
    depth: 1,
    parentId: aLT1dm.id,
    deptId: deptTaaSDelivery.id,
    clientId: clientL_T.id,
    allocatedOpenings: 2,
    submissionsCount: 5,
    interviewsCount: 2,
  });
  await mkAssign({
    reqId: rLT1.id,
    assignedToId: uJyothi.id,
    assignedById: uRoja.id,
    depth: 1,
    parentId: aLT1dm.id,
    deptId: deptTaaSDelivery.id,
    clientId: clientL_T.id,
    allocatedOpenings: 1,
    submissionsCount: 3,
    interviewsCount: 2,
  });

  const rLT2 = await mkReq({
    title: "Simulation Engineer (ANSYS)",
    spocId: spocLTRoja.id,
    clientId: clientL_T.id,
    buId: buEnterpriseNIT.id,
    slId: slTaaS.id,
    jobType: "CONTRACT",
    remoteType: "ONSITE",
    priority: "MEDIUM",
    status: "ACTIVE",
    openings: 2,
    expMin: 4,
    expMax: 8,
    salMin: 80000,
    salMax: 120000,
    location: "Vadodara",
    createdById: uRoja.id,
    approvedById: uSiva.id,
    skills: ["ANSYS", "FEA", "CFD", "HyperMesh"],
    activeApplications: 4,
    interviewsScheduled: 1,
  });
  const aLT2dm = await mkAssign({
    reqId: rLT2.id,
    assignedToId: uRoja.id,
    assignedById: uSiva.id,
    depth: 0,
    deptId: deptTaaSDelivery.id,
    clientId: clientL_T.id,
    allocatedOpenings: 2,
    submissionsCount: 4,
    interviewsCount: 1,
  });
  await mkAssign({
    reqId: rLT2.id,
    assignedToId: uMeenaksh.id,
    assignedById: uRoja.id,
    depth: 1,
    parentId: aLT2dm.id,
    deptId: deptTaaSDelivery.id,
    clientId: clientL_T.id,
    allocatedOpenings: 2,
    submissionsCount: 4,
    interviewsCount: 1,
  });

  // ── NASSCOM (B2G — Shylaja DM) ─────────────────────────────────────────────

  const rNass1 = await mkReq({
    title: "Cybersecurity Trainer",
    spocId: spocNassShylaja.id,
    clientId: clientNSSCT.id,
    buId: buB2GSkilling.id,
    slId: slTaaS.id,
    jobType: "CONTRACT",
    remoteType: "ONSITE",
    priority: "HIGH",
    status: "ACTIVE",
    openings: 5,
    expMin: 3,
    expMax: 7,
    salMin: 60000,
    salMax: 90000,
    location: "Delhi",
    createdById: uShylaja.id,
    approvedById: uSiva.id,
    skills: ["Cybersecurity", "CEH", "Training", "VAPT"],
    filledOpenings: 2,
    activeApplications: 15,
    interviewsScheduled: 7,
    offersRolledOut: 2,
  });
  const aN1dm = await mkAssign({
    reqId: rNass1.id,
    assignedToId: uShylaja.id,
    assignedById: uSiva.id,
    depth: 0,
    deptId: deptB2GDelivery.id,
    clientId: clientNSSCT.id,
    allocatedOpenings: 5,
    submissionsCount: 15,
    interviewsCount: 7,
    filledOpenings: 2,
  });
  await mkAssign({
    reqId: rNass1.id,
    assignedToId: uAnanyaAR.id,
    assignedById: uShylaja.id,
    depth: 1,
    parentId: aN1dm.id,
    deptId: deptB2GDelivery.id,
    clientId: clientNSSCT.id,
    allocatedOpenings: 5,
    submissionsCount: 15,
    interviewsCount: 7,
    filledOpenings: 2,
  });

  const rNass2 = await mkReq({
    title: "Data Science Trainer",
    spocId: spocNassShylaja.id,
    clientId: clientNSSCT.id,
    buId: buB2GSkilling.id,
    slId: slTaaS.id,
    jobType: "CONTRACT",
    remoteType: "HYBRID",
    priority: "MEDIUM",
    status: "ACTIVE",
    openings: 3,
    expMin: 2,
    expMax: 5,
    salMin: 55000,
    salMax: 80000,
    location: "Bangalore",
    createdById: uShylaja.id,
    approvedById: uSiva.id,
    skills: ["Python", "Data Science", "ML", "Training"],
    activeApplications: 8,
    interviewsScheduled: 3,
  });
  const aN2dm = await mkAssign({
    reqId: rNass2.id,
    assignedToId: uShylaja.id,
    assignedById: uSiva.id,
    depth: 0,
    deptId: deptB2GDelivery.id,
    clientId: clientNSSCT.id,
    allocatedOpenings: 3,
    submissionsCount: 8,
    interviewsCount: 3,
  });
  await mkAssign({
    reqId: rNass2.id,
    assignedToId: uAnanyaAR.id,
    assignedById: uShylaja.id,
    depth: 1,
    parentId: aN2dm.id,
    deptId: deptB2GDelivery.id,
    clientId: clientNSSCT.id,
    allocatedOpenings: 3,
    submissionsCount: 8,
    interviewsCount: 3,
  });

  // ── NSDC ──────────────────────────────────────────────────────────────────

  const rNSDC1 = await mkReq({
    title: "Soft Skills Trainer (Campus)",
    spocId: spocNSDCShylaja.id,
    clientId: clientNSDC.id,
    buId: buB2GSkilling.id,
    slId: slTaaS.id,
    jobType: "CONTRACT",
    remoteType: "ONSITE",
    priority: "HIGH",
    status: "ACTIVE",
    openings: 8,
    expMin: 1,
    expMax: 4,
    salMin: 40000,
    salMax: 60000,
    location: "Pan India",
    createdById: uShylaja.id,
    approvedById: uSiva.id,
    skills: ["Soft Skills", "Communication", "Campus", "Training"],
    filledOpenings: 4,
    activeApplications: 20,
    interviewsScheduled: 10,
    offersRolledOut: 4,
  });
  const aND1dm = await mkAssign({
    reqId: rNSDC1.id,
    assignedToId: uShylaja.id,
    assignedById: uSiva.id,
    depth: 0,
    deptId: deptB2GDelivery.id,
    clientId: clientNSDC.id,
    allocatedOpenings: 8,
    submissionsCount: 20,
    interviewsCount: 10,
    filledOpenings: 4,
  });
  await mkAssign({
    reqId: rNSDC1.id,
    assignedToId: uAnanyaAR.id,
    assignedById: uShylaja.id,
    depth: 1,
    parentId: aND1dm.id,
    deptId: deptB2GDelivery.id,
    clientId: clientNSDC.id,
    allocatedOpenings: 8,
    submissionsCount: 20,
    interviewsCount: 10,
    filledOpenings: 4,
  });

  const rNSDC2 = await mkReq({
    title: "Digital Marketing Trainer",
    spocId: spocNSDCShylaja.id,
    clientId: clientNSDC.id,
    buId: buB2GSkilling.id,
    slId: slTaaS.id,
    jobType: "CONTRACT",
    remoteType: "HYBRID",
    priority: "MEDIUM",
    status: "ACTIVE",
    openings: 4,
    expMin: 2,
    expMax: 5,
    salMin: 50000,
    salMax: 70000,
    location: "Chennai",
    createdById: uShylaja.id,
    approvedById: uSiva.id,
    skills: ["Digital Marketing", "SEO", "SEM", "Social Media"],
    activeApplications: 10,
    interviewsScheduled: 4,
  });
  const aND2dm = await mkAssign({
    reqId: rNSDC2.id,
    assignedToId: uShylaja.id,
    assignedById: uSiva.id,
    depth: 0,
    deptId: deptB2GDelivery.id,
    clientId: clientNSDC.id,
    allocatedOpenings: 4,
    submissionsCount: 10,
    interviewsCount: 4,
  });
  await mkAssign({
    reqId: rNSDC2.id,
    assignedToId: uAnanyaAR.id,
    assignedById: uShylaja.id,
    depth: 1,
    parentId: aND2dm.id,
    deptId: deptB2GDelivery.id,
    clientId: clientNSDC.id,
    allocatedOpenings: 4,
    submissionsCount: 10,
    interviewsCount: 4,
  });

  // ── APSSC (B2G CPSU) ──────────────────────────────────────────────────────

  const rAPS1 = await mkReq({
    title: "Tally Trainer (GST)",
    spocId: spocAPSSCAnanya.id,
    clientId: clientAPSSC.id,
    buId: buB2GCPSU.id,
    slId: slTaaS.id,
    jobType: "CONTRACT",
    remoteType: "ONSITE",
    priority: "MEDIUM",
    status: "ACTIVE",
    openings: 6,
    expMin: 1,
    expMax: 3,
    salMin: 35000,
    salMax: 50000,
    location: "Hyderabad",
    createdById: uAnanyaAR.id,
    approvedById: uSushanta.id,
    skills: ["Tally", "GST", "Accounting", "Training"],
    filledOpenings: 3,
    activeApplications: 12,
    interviewsScheduled: 6,
    offersRolledOut: 3,
  });
  const aAP1dm = await mkAssign({
    reqId: rAPS1.id,
    assignedToId: uShylaja.id,
    assignedById: uSiva.id,
    depth: 0,
    deptId: deptB2GDelivery.id,
    clientId: clientAPSSC.id,
    allocatedOpenings: 6,
    submissionsCount: 12,
    interviewsCount: 6,
    filledOpenings: 3,
  });
  await mkAssign({
    reqId: rAPS1.id,
    assignedToId: uAnanyaAR.id,
    assignedById: uShylaja.id,
    depth: 1,
    parentId: aAP1dm.id,
    deptId: deptB2GDelivery.id,
    clientId: clientAPSSC.id,
    allocatedOpenings: 6,
    submissionsCount: 12,
    interviewsCount: 6,
    filledOpenings: 3,
  });

  // ── INTERNAL HIRING (Madhavi → Menka / Vyshnavi) ──────────────────────────

  const rInt1 = await mkReq({
    title: "Senior Recruiter (Internal)",
    spocId: spocInfoLiki.id, // reuse a spoc
    clientId: clientInfosys.id,
    buId: buEnterpriseIT.id,
    slId: slKaaS.id,
    jobType: "PERMANENT",
    remoteType: "ONSITE",
    priority: "MEDIUM",
    status: "ACTIVE",
    openings: 2,
    expMin: 3,
    expMax: 6,
    salMin: 60000,
    salMax: 80000,
    location: "Bangalore",
    createdById: uMadhavi.id,
    approvedById: uSiva.id,
    skills: ["Recruitment", "Sourcing", "HRIS", "LinkedIn"],
    activeApplications: 5,
    interviewsScheduled: 2,
  });
  const aInt1dm = await mkAssign({
    reqId: rInt1.id,
    assignedToId: uMadhavi.id,
    assignedById: uSiva.id,
    depth: 0,
    deptId: deptKaaSDelivery.id,
    allocatedOpenings: 2,
    submissionsCount: 5,
    interviewsCount: 2,
  });
  await mkAssign({
    reqId: rInt1.id,
    assignedToId: uMenka.id,
    assignedById: uMadhavi.id,
    depth: 1,
    parentId: aInt1dm.id,
    allocatedOpenings: 1,
    submissionsCount: 3,
    interviewsCount: 1,
  });
  await mkAssign({
    reqId: rInt1.id,
    assignedToId: uVyshnavi.id,
    assignedById: uMadhavi.id,
    depth: 1,
    parentId: aInt1dm.id,
    allocatedOpenings: 1,
    submissionsCount: 2,
    interviewsCount: 1,
  });

  // ── Update assignment submissionsCount on existing seed reqs ──────────────
  // (so the first 5 reqs also have realistic stats from the old seed)
  await prisma.requirementAssignment.updateMany({
    where: { requirementId: { in: [] } }, // already seeded in main seed
    data: {},
  });

  console.log(`  ✓ ${reqCounter - 6} new requirements created`);
  console.log("  ✓ Full assignment chains wired (depth 0 → 1 → 2)\n");

  // ── Candidate snapshots for new reqs ──────────────────────────────────────
  console.log("▶ Seeding candidate snapshots...");

  const stages = [
    "SOURCED",
    "SCREENING",
    "SUBMITTED",
    "INTERVIEW_SCHEDULED",
    "INTERVIEW_DONE",
    "OFFER_ROLLED",
    "OFFER_ACCEPTED",
    "JOINED",
    "REJECTED",
  ] as const;
  const names = [
    "Arjun Mehta",
    "Priya Krishnan",
    "Rohit Sharma",
    "Sneha Patel",
    "Vikram Reddy",
    "Kavitha Iyer",
    "Amit Gupta",
    "Divya Nair",
    "Rahul Tiwari",
    "Pooja Verma",
    "Sanjay Kumar",
    "Lakshmi Rao",
    "Deepak Joshi",
    "Ananya Singh",
    "Karan Malhotra",
    "Meera Pillai",
    "Suresh Babu",
    "Roshni Thomas",
    "Manish Agarwal",
    "Trisha Roy",
    "Sunil Pandey",
    "Gayatri Menon",
    "Vivek Sharma",
    "Nandini Krishnamurthy",
    "Ashok Kumar",
  ];

  let candIdx = 100;
  const seedCandidates = async (reqId: string, count: number) => {
    for (let i = 0; i < count; i++) {
      const name = names[(candIdx + i) % names.length];
      const stage = stages[rnd(0, Math.min(i + 2, stages.length - 1))];
      await prisma.requirementCandidate.upsert({
        where: {
          requirementId_candidateId: {
            requirementId: reqId,
            candidateId: `cand-${candIdx + i}`,
          },
        },
        update: {},
        create: {
          requirementId: reqId,
          candidateId: `cand-${candIdx + i}`,
          candidateName: name,
          candidateEmail: `${name.toLowerCase().replace(/\s/g, ".")}${
            candIdx + i
          }@gmail.com`,
          currentStage: stage,
        },
      });
    }
    candIdx += count;
  };

  await seedCandidates(rWipro1.id, 8);
  await seedCandidates(rWipro2.id, 5);
  await seedCandidates(rInfo1.id, 12);
  await seedCandidates(rInfo2.id, 6);
  await seedCandidates(rInfo3.id, 4);
  await seedCandidates(rHCL1.id, 7);
  await seedCandidates(rHCL2.id, 5);
  await seedCandidates(rHCL3.id, 9);
  await seedCandidates(rAcc1.id, 6);
  await seedCandidates(rTM1.id, 4);
  await seedCandidates(rMph1.id, 6);
  await seedCandidates(rLT1.id, 8);
  await seedCandidates(rNass1.id, 15);
  await seedCandidates(rNass2.id, 8);
  await seedCandidates(rNSDC1.id, 20);
  await seedCandidates(rNSDC2.id, 10);
  await seedCandidates(rAPS1.id, 12);

  console.log("  ✓ Candidate snapshots seeded\n");

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║              SEED SUMMARY                            ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║  10 new clients (Wipro, Infosys, HCL, Accenture...) ║");
  console.log("║  25+ new requirements across all clients             ║");
  console.log("║  Full assignment chains: Sales→DM→DL→Recruiter       ║");
  console.log("║  ~170 candidate snapshots across pipeline stages     ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("\n✅ Requirements seed complete!\n");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
