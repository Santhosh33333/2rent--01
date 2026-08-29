import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function migrateData() {
  console.log("Starting data migration...\n");

  // 1. Migrate WalkingPartner → Partner
  console.log("1. Migrating WalkingPartner → Partner...");
  const walkingPartners = await prisma.walkingPartner.findMany();
  let partnerCount = 0;
  for (const wp of walkingPartners) {
    await prisma.partner.upsert({
      where: { userId: wp.userId },
      update: {},
      create: {
        userId: wp.userId,
        status: wp.status === "APPROVED" ? "APPROVED" : wp.status === "REJECTED" ? "REJECTED" : "APPLIED",
        providesWalking: true,
        providesCarry: false,
        rating: Number(wp.rating),
        totalJobs: wp.totalWalks,
        totalEarnings: Number(wp.totalEarnings),
        completedJobs: wp.totalWalks,
        bankAccountName: wp.bankAccountName,
        bankAccountNumber: wp.bankAccountNumber,
        bankIfsc: wp.bankIfsc,
        upiId: wp.upiId,
        reviewedBy: wp.reviewedBy,
        reviewedAt: wp.reviewedAt,
        rejectionReason: wp.rejectionReason,
      },
    });
    partnerCount++;
  }
  console.log(`   Migrated ${partnerCount} walking partners`);

  // Also create Partner records for users with isCarryBuddyApproved
  // (These were in the old boolean flags which are now dropped)
  // We'll check RoleApplication records for carry buddy approvals
  const carryApps = await prisma.roleApplication.findMany({
    where: { role: "CARRY_BUDDY_PARTNER", status: "APPROVED" },
  });
  let carryPartnerCount = 0;
  for (const app of carryApps) {
    const existing = await prisma.partner.findUnique({ where: { userId: app.userId } });
    if (existing) {
      await prisma.partner.update({
        where: { userId: app.userId },
        data: { providesCarry: true },
      });
    } else {
      await prisma.partner.create({
        data: {
          userId: app.userId,
          status: "APPROVED",
          providesWalking: false,
          providesCarry: true,
        },
      });
    }
    carryPartnerCount++;
  }
  console.log(`   Migrated ${carryPartnerCount} carry buddy approvals to Partner`);

  // 2. Migrate WalkingRequest → Booking
  console.log("\n2. Migrating WalkingRequest → Booking...");
  const walkingRequests = await prisma.walkingRequest.findMany();
  let bookingCount = 0;
  for (const wr of walkingRequests) {
    // Map status
    let status = "PAYMENT_PENDING";
    switch (wr.status) {
      case "OPEN": status = "PARTNER_SEARCHING"; break;
      case "ACCEPTED": status = "PARTNER_ACCEPTED"; break;
      case "IN_PROGRESS": status = "IN_PROGRESS"; break;
      case "COMPLETED": status = "COMPLETED"; break;
      case "CANCELLED": status = "CANCELLED"; break;
    }

    // Find partner if accepted
    let partnerId: string | null = null;
    if (wr.acceptedById) {
      const partner = await prisma.partner.findUnique({ where: { userId: wr.acceptedById } });
      partnerId = partner?.id || null;
    }

    await prisma.booking.create({
      data: {
        userId: wr.requesterId,
        partnerId,
        serviceType: "WALKING",
        status,
        startLocation: wr.startLocation,
        endLocation: wr.endLocation,
        scheduledAt: wr.startTime,
        durationMinutes: wr.durationMinutes,
        completedAt: wr.completedAt,
        estimatedAmount: wr.fare ? Number(wr.fare) : null,
        finalAmount: wr.fare ? Number(wr.fare) : null,
        platformFee: wr.platformFee ? Number(wr.platformFee) : null,
        partnerEarning: wr.partnerEarning ? Number(wr.partnerEarning) : null,
        notes: wr.notes || null,
        createdAt: wr.createdAt,
        updatedAt: wr.updatedAt,
      },
    });
    bookingCount++;
  }
  console.log(`   Migrated ${bookingCount} walking requests → bookings`);

  // 3. Migrate CarryBuddyRequest → Booking
  console.log("\n3. Migrating CarryBuddyRequest → Booking...");
  const carryRequests = await prisma.carryBuddyRequest.findMany();
  let carryBookingCount = 0;
  for (const cb of carryRequests) {
    let status = "PAYMENT_PENDING";
    switch (cb.status) {
      case "OPEN": status = "PARTNER_SEARCHING"; break;
      case "ACCEPTED": status = "PARTNER_ACCEPTED"; break;
      case "COMPLETED": status = "COMPLETED"; break;
      case "CANCELLED": status = "CANCELLED"; break;
    }

    let partnerId: string | null = null;
    if (cb.acceptedById) {
      const partner = await prisma.partner.findUnique({ where: { userId: cb.acceptedById } });
      partnerId = partner?.id || null;
    }

    await prisma.booking.create({
      data: {
        userId: cb.requesterId,
        partnerId,
        serviceType: "CARRY_BUDDY",
        status,
        startLocation: cb.startLocation,
        endLocation: cb.endLocation,
        scheduledAt: cb.startTime,
        durationMinutes: cb.durationMinutes,
        completedAt: cb.completedAt,
        estimatedAmount: cb.fare ? Number(cb.fare) : null,
        finalAmount: cb.fare ? Number(cb.fare) : null,
        platformFee: cb.platformFee ? Number(cb.platformFee) : null,
        partnerEarning: cb.partnerEarning ? Number(cb.partnerEarning) : null,
        itemType: cb.itemType || null,
        itemDescription: cb.itemDescription || null,
        notes: cb.notes || null,
        createdAt: cb.createdAt,
        updatedAt: cb.updatedAt,
      },
    });
    carryBookingCount++;
  }
  console.log(`   Migrated ${carryBookingCount} carry buddy requests → bookings`);

  // Summary
  const totalBookings = await prisma.booking.count();
  const totalPartners = await prisma.partner.count();
  console.log(`\n=== Migration Complete ===`);
  console.log(`Total Bookings: ${totalBookings}`);
  console.log(`Total Partners: ${totalPartners}`);
}

migrateData()
  .then(() => {
    console.log("\nMigration script finished successfully.");
    return prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error("Migration failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
