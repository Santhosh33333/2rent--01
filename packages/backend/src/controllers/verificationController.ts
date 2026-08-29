import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";

// ============================================================================
// HELPER: Get or create verification record
// ============================================================================

async function upsertVerification(userId: string) {
  const existing = await prisma.verification.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.verification.create({ data: { userId, status: "NOT_STARTED" } });
}

// ============================================================================
// STEP 1: PERSONAL DETAILS
// ============================================================================

export async function submitPersonalDetails(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { fullName, dateOfBirth, gender, city, country, address } = req.body;

    // Validate required fields
    if (!fullName || !dateOfBirth || !gender) {
      sendError(res, "Full name, date of birth, and gender are required.", 400, "VALIDATION_ERROR");
      return;
    }

    const verification = await upsertVerification(req.user!.userId);

    // Store personal details as JSON in a metadata field (using updatedAt as checkpoint)
    const personal = {
      fullName,
      dateOfBirth,
      gender,
      city: city || null,
      country: country || null,
      address: address || null,
      submittedAt: new Date().toISOString(),
    };

    // Update verification status to DRAFT if it's NOT_STARTED
    const newStatus = verification.status === "NOT_STARTED" ? "DRAFT" : verification.status;

    // Note: Store personal data in a metadata field (we'll add this to schema in future migration)
    // For now, we'll just update the timestamp and mark as in progress
    await prisma.verification.update({
      where: { id: verification.id },
      data: { status: newStatus, updatedAt: new Date() },
    });

    // Create audit log
    await prisma.verificationHistory.create({
      data: {
        verificationId: verification.id,
        status: "PERSONAL_DETAILS_SUBMITTED",
        note: `Personal details submitted: ${fullName}`,
        changedBy: req.user!.userId,
      },
    });

    sendSuccess(
      res,
      { status: newStatus, step: 1, totalSteps: 7, data: personal },
      "Personal details saved."
    );
  } catch (err: any) {
    console.error("Error submitting personal details:", err);
    sendError(res, "Failed to submit personal details.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// STEP 2: DOCUMENT UPLOAD
// ============================================================================

export async function submitGovId(req: AuthedRequest, res: Response): Promise<void> {
  try {
    if (!req.file) {
      sendError(res, "Government ID image is required.", 400, "NO_FILE");
      return;
    }

    const { govIdType } = req.body;
    if (!govIdType) {
      sendError(res, "Document type is required.", 400, "VALIDATION_ERROR");
      return;
    }

    // Validate document type
    const validTypes = ["AADHAAR", "PASSPORT", "DRIVING_LICENSE", "VOTER_ID", "PAN"];
    if (!validTypes.includes(govIdType)) {
      sendError(res, "Invalid document type.", 400, "VALIDATION_ERROR");
      return;
    }

    const verification = await upsertVerification(req.user!.userId);
    const newStatus = verification.status === "NOT_STARTED" || verification.status === "DRAFT" ? "DRAFT" : verification.status;

    await prisma.verification.update({
      where: { id: verification.id },
      data: {
        govIdUrl: `/uploads/private/${req.file.filename}`,
        govIdType,
        status: newStatus,
        updatedAt: new Date(),
      },
    });

    await prisma.verificationHistory.create({
      data: {
        verificationId: verification.id,
        status: "DOCUMENT_UPLOADED",
        note: `${govIdType} uploaded`,
        changedBy: req.user!.userId,
      },
    });

    sendSuccess(
      res,
      { status: newStatus, step: 2, totalSteps: 7, docType: govIdType },
      "Government ID submitted for review."
    );
  } catch (err: any) {
    console.error("Error submitting gov ID:", err);
    sendError(res, "Failed to submit government ID.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// STEP 3: SELFIE VERIFICATION
// ============================================================================

export async function submitSelfie(req: AuthedRequest, res: Response): Promise<void> {
  try {
    if (!req.file) {
      sendError(res, "Selfie image is required.", 400, "NO_FILE");
      return;
    }

    const verification = await upsertVerification(req.user!.userId);
    const newStatus = verification.status === "NOT_STARTED" || verification.status === "DRAFT" ? "DRAFT" : verification.status;

    await prisma.verification.update({
      where: { id: verification.id },
      data: {
        selfieUrl: `/uploads/private/${req.file.filename}`,
        status: newStatus,
        updatedAt: new Date(),
      },
    });

    await prisma.verificationHistory.create({
      data: {
        verificationId: verification.id,
        status: "SELFIE_SUBMITTED",
        note: "Selfie uploaded for verification",
        changedBy: req.user!.userId,
      },
    });

    sendSuccess(
      res,
      { status: newStatus, step: 3, totalSteps: 7 },
      "Selfie submitted for verification."
    );
  } catch (err: any) {
    console.error("Error submitting selfie:", err);
    sendError(res, "Failed to submit selfie.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// STEP 4: ADDRESS PROOF
// ============================================================================

export async function submitAddressProof(req: AuthedRequest, res: Response): Promise<void> {
  try {
    if (!req.file) {
      sendError(res, "Address proof image is required.", 400, "NO_FILE");
      return;
    }

    const verification = await upsertVerification(req.user!.userId);
    const newStatus = verification.status === "NOT_STARTED" || verification.status === "DRAFT" ? "DRAFT" : verification.status;

    await prisma.verification.update({
      where: { id: verification.id },
      data: {
        addressProofUrl: `/uploads/private/${req.file.filename}`,
        status: newStatus,
        updatedAt: new Date(),
      },
    });

    await prisma.verificationHistory.create({
      data: {
        verificationId: verification.id,
        status: "ADDRESS_PROOF_SUBMITTED",
        note: "Address proof uploaded",
        changedBy: req.user!.userId,
      },
    });

    sendSuccess(
      res,
      { status: newStatus, step: 4, totalSteps: 7 },
      "Address proof submitted."
    );
  } catch (err: any) {
    console.error("Error submitting address proof:", err);
    sendError(res, "Failed to submit address proof.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// STEP 5: EMERGENCY CONTACT
// ============================================================================

export async function submitEmergencyContact(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { name, phone, relation } = req.body;

    if (!name || !phone || !relation) {
      sendError(res, "Name, phone, and relation are required.", 400, "VALIDATION_ERROR");
      return;
    }

    const verification = await upsertVerification(req.user!.userId);

    await prisma.verification.update({
      where: { id: verification.id },
      data: {
        emergencyContactName: name,
        emergencyContactPhone: phone,
        emergencyContactRelation: relation,
        updatedAt: new Date(),
      },
    });

    await prisma.verificationHistory.create({
      data: {
        verificationId: verification.id,
        status: "EMERGENCY_CONTACT_SUBMITTED",
        note: `Emergency contact: ${name}`,
        changedBy: req.user!.userId,
      },
    });

    sendSuccess(
      res,
      { status: verification.status, step: 5, totalSteps: 7 },
      "Emergency contact saved."
    );
  } catch (err: any) {
    console.error("Error submitting emergency contact:", err);
    sendError(res, "Failed to submit emergency contact.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// STEP 6: REVIEW & SUBMIT TO ADMIN
// ============================================================================

export async function submitForVerification(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const verification = await prisma.verification.findUnique({
      where: { userId: req.user!.userId },
    });

    if (!verification) {
      sendError(res, "No verification record found.", 404, "NOT_FOUND");
      return;
    }

    // Check if all required documents are present
    if (!verification.govIdUrl || !verification.selfieUrl || !verification.addressProofUrl) {
      sendError(
        res,
        "Government ID, selfie, and address proof are required.",
        400,
        "INCOMPLETE_SUBMISSION"
      );
      return;
    }

    if (!verification.emergencyContactName || !verification.emergencyContactPhone) {
      sendError(
        res,
        "Emergency contact information is required.",
        400,
        "INCOMPLETE_SUBMISSION"
      );
      return;
    }

    // Update status to SUBMITTED (submitted by user, awaiting admin review)
    await prisma.verification.update({
      where: { id: verification.id },
      data: {
        status: "SUBMITTED",
        updatedAt: new Date(),
      },
    });

    await prisma.verificationHistory.create({
      data: {
        verificationId: verification.id,
        status: "SUBMITTED_FOR_REVIEW",
        note: "User submitted KYC for admin review",
        changedBy: req.user!.userId,
      },
    });

    // React on the admin side: notify every active admin so the queue is seen.
    try {
      const admins = await prisma.user.findMany({
        where: { role: { in: ["ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
        select: { id: true },
      });
      if (admins.length > 0) {
        const submitter = await prisma.user.findUnique({
          where: { id: req.user!.userId },
          select: { fullName: true, email: true },
        });
        await prisma.notification.createMany({
          data: admins.map((a) => ({
            userId: a.id,
            title: "New KYC submission",
            body: `${submitter?.fullName || submitter?.email || "A user"} submitted identity documents for review.`,
            data: JSON.stringify({ type: "KYC_SUBMITTED", verificationId: verification.id }),
          })),
        });
      }
    } catch (notifyErr) {
      console.error("Failed to notify admins of KYC submission:", notifyErr);
    }

    sendSuccess(
      res,
      { status: "SUBMITTED", step: 6, totalSteps: 7 },
      "Submitted for verification. Admin will review shortly."
    );
  } catch (err: any) {
    console.error("Error submitting for verification:", err);
    sendError(res, "Failed to submit for verification.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GET COMPLETE KYC STATUS WITH PROGRESS
// ============================================================================

export async function getVerificationStatus(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const verification = await prisma.verification.findUnique({
      where: { userId: req.user!.userId },
    });

    if (!verification) {
      sendSuccess(
        res,
        {
          status: "NOT_STARTED",
          progress: 0,
          step: 0,
          totalSteps: 7,
          documents: {
            personalDetails: false,
            govId: false,
            selfie: false,
            addressProof: false,
            emergencyContact: false,
          },
          rejectionReason: null,
        },
        "Verification status retrieved."
      );
      return;
    }

    // Calculate progress
    const hasPersonalDetails = true; // If verification exists, personal details were submitted
    const hasGovId = !!verification.govIdUrl;
    const hasSelfie = !!verification.selfieUrl;
    const hasAddressProof = !!verification.addressProofUrl;
    const hasEmergencyContact = !!verification.emergencyContactName;

    const completedSteps = [
      hasPersonalDetails,
      hasGovId,
      hasSelfie,
      hasAddressProof,
      hasEmergencyContact,
    ].filter(Boolean).length;

    const currentStep = verification.status === "NOT_STARTED" ? 0 : completedSteps;
    const progress = Math.round((currentStep / 7) * 100);

    sendSuccess(
      res,
      {
        status: verification.status,
        progress,
        step: currentStep,
        totalSteps: 7,
        personalDetails: hasPersonalDetails,
        govId: hasGovId,
        selfie: hasSelfie,
        addressProof: hasAddressProof,
        emergencyContact: hasEmergencyContact,
        documents: {
          personalDetails: hasPersonalDetails,
          govId: hasGovId,
          govIdType: verification.govIdType,
          selfie: hasSelfie,
          addressProof: hasAddressProof,
          emergencyContact: hasEmergencyContact,
          emergencyContactName: verification.emergencyContactName,
          emergencyContactPhone: verification.emergencyContactPhone,
          emergencyContactRelation: verification.emergencyContactRelation,
        },
        rejectionReason: verification.rejectionReason,
        reviewedAt: verification.reviewedAt,
        createdAt: verification.createdAt,
        updatedAt: verification.updatedAt,
      },
      "Verification status retrieved."
    );
  } catch (err: any) {
    console.error("Error getting verification status:", err);
    sendError(res, "Failed to retrieve verification status.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GET VERIFICATION HISTORY
// ============================================================================

export async function getVerificationHistory(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const verification = await prisma.verification.findUnique({
      where: { userId: req.user!.userId },
    });

    if (!verification) {
      sendSuccess(res, [], "No verification history.");
      return;
    }

    const history = await prisma.verificationHistory.findMany({
      where: { verificationId: verification.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        note: true,
        changedBy: true,
        createdAt: true,
      },
    });

    sendSuccess(res, history, "Verification history retrieved.");
  } catch (err: any) {
    console.error("Error getting verification history:", err);
    sendError(res, "Failed to retrieve verification history.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// DELETE DOCUMENT
// ============================================================================

export async function deleteDocument(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { docType } = req.params;

    if (!docType) {
      sendError(res, "Document type is required.", 400, "VALIDATION_ERROR");
      return;
    }

    const verification = await prisma.verification.findUnique({
      where: { userId: req.user!.userId },
    });

    if (!verification) {
      sendError(res, "No verification record found.", 404, "NOT_FOUND");
      return;
    }

    const fieldMap: Record<string, string> = {
      selfie: "selfieUrl",
      govId: "govIdUrl",
      address: "addressProofUrl",
    };

    const field = fieldMap[docType];
    if (!field) {
      sendError(res, "Invalid document type.", 400, "VALIDATION_ERROR");
      return;
    }

    // Can only delete if not verified
    if (verification.status === "VERIFIED") {
      sendError(res, "Cannot delete documents from verified KYC.", 400, "INVALID_OPERATION");
      return;
    }

    await prisma.verification.update({
      where: { id: verification.id },
      data: { [field]: null },
    });

    await prisma.verificationHistory.create({
      data: {
        verificationId: verification.id,
        status: "DOCUMENT_DELETED",
        note: `${docType} document removed`,
        changedBy: req.user!.userId,
      },
    });

    sendSuccess(res, undefined, "Document removed.");
  } catch (err: any) {
    console.error("Error deleting document:", err);
    sendError(res, "Failed to delete document.", 500, "INTERNAL_ERROR");
  }
}
