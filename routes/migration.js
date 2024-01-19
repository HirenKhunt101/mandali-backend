const express = require("express");
const router = express.Router();
const migration = require("../controllers/migration");

router.post("/add_member_migrate", migration.add_member_migrate);
router.post(
  "/create_installment_migrate",
  migration.create_installment_migrate
);

module.exports = router;
