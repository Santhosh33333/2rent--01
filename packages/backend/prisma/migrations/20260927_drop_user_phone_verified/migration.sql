-- Drop the vestigial "phoneVerified" column.
--
-- Every server-side verification gate reads "mobileVerified"; the backend never
-- wrote "phoneVerified" anywhere. The only reader was the mobile client, which
-- mapped it into its auth store and therefore always stored false -- including
-- for accounts whose mobile number was genuinely verified. The client now maps
-- "mobileVerified" instead, so the column is dead weight and a trap.
ALTER TABLE "User" DROP COLUMN IF EXISTS "phoneVerified";
