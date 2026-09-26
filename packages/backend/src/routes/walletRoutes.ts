import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken, requireKycVerified } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import { upload } from "../middleware/upload";
import * as walletController from "../controllers/walletController";

const router = Router();

router.use(authenticateToken, requireKycVerified);

// Get wallet
router.get("/", walletController.getWallet);

// Topup wallet
router.post(
  "/topup",
  [body("amount").isFloat({ gt: 0 }).withMessage("Invalid topup amount")],
  sanitizeInput,
  validateRequest,
  walletController.topupWallet
);

// Manual-UPI top-up requests (pay platform QR externally, admin verifies)
router.post(
  "/topup-requests",
  [
    body("amount").isFloat({ min: 10 }).withMessage("Minimum top-up is Rs 10"),
    body("referenceNumber").isString().trim().isLength({ min: 6 }).withMessage("Valid UTR required"),
  ],
  sanitizeInput,
  validateRequest,
  walletController.requestTopup
);
router.post("/:id/topup-proof", upload.single("proof"), walletController.uploadTopupProof);
router.get("/topup-requests", walletController.getMyTopupRequests);

// Wallet rules (limits shown to clients)
router.get("/config", walletController.getWalletConfig);

// Payout-destination auto-fill: IFSC -> bank name, UPI ID -> holder name/bank
router.get("/bank-info", walletController.getBankInfo);
router.get("/upi-info", walletController.getUpiInfo);


// Get transactions
router.get("/transactions", walletController.getTransactions);

// Get withdrawals
router.get("/withdrawals", walletController.getWithdrawalHistory);

// Request withdrawal
router.post(
  "/withdraw",
  [
    body("amount").isFloat({ gt: 0 }).withMessage("Invalid withdrawal amount"),
    body("method").notEmpty().isIn(["BANK_TRANSFER", "UPI"]).withMessage("Invalid withdrawal method"),
    body("accountDetail").notEmpty().withMessage("Account details required"),
  ],
  sanitizeInput,
  validateRequest,
  walletController.requestWithdrawal
);

// Cancel withdrawal
router.delete("/withdraw/:id", walletController.cancelWithdrawal);

// Get earnings summary
router.get("/earnings", walletController.getEarningsSummary);

// Get earnings details
router.get("/earnings/details", walletController.getEarningDetails);

// Get earnings chart
router.get("/earnings/chart", walletController.getEarningsChart);

export default router;

