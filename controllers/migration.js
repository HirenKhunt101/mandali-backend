const mongo = require("../database/database.service");
const schema = require("../database/database.schema");
const bcrypt = require("bcryptjs");
const SALT_WORK_FACTOR = 10;
const mongoose = require("mongoose");

const User = schema.User;
const Mandali = schema.Mandali;
const Activity = schema.Activity;
const Installment = schema.Installment;
const Penalty = schema.Penalty;
const Stock = schema.Stock;
const Realized = schema.Realized;

let add_member_migrate = async function (req, res) {
  let body = req.body;
  let data = {};
  try {
    let data = body;
    for (let d of data) {
      let user = {};
      user.Email = d.Email;
      user.FirstName = d.FirstName;
      user.LastName = d.LastName;
      user.Password = bcrypt.hashSync("mandali@123", SALT_WORK_FACTOR);
      user.UserType = "member";
      user.IsLoginAble = true;
      user.MandaliId = new mongoose.Types.ObjectId("65a28c70bb9eb82394eeb811");
      user.Username = d.FirstName + " " + d.LastName;
      user.NoOfAccount = d.NoOfAccount;
      user.ContactNumber = d.ContactNumber;
      user = new User(user);
      await user.save();
    }

    return res.status(201).json({
      statusMessage: " User Profile Created Successfully",
      success: true,
    });
  } catch (error) {
    console.log(`Error in catch : ${error}`);
    return res.status(501).json({
      statusMessage: "Error in add member, Please try again!",
      data: error,
      success: false,
    });
  }
};

let create_installment_migrate = async function (req, res) {
  let data = {};
  try {
    let userdata = await User.find();

    for (let ud of userdata) {
      for (let i = 0; i < ud.NoOfAccount; i++) {
        let list = [];
        for (let j = 0; j < 14; j++) {
          let StartDate = new Date();
          StartDate.setUTCHours(0, 0, 0, 0);
          StartDate.setDate(1);
          StartDate.setMonth((j + 11) % 12);
          if (j == 0) {
            StartDate.setFullYear(2022);
          } else if (j < 13) {
            StartDate.setFullYear(2023);
          } else {
            StartDate.setFullYear(2024);
          }

          let body = {
            Date: StartDate,
            Amount: j < 12 ? 1000 : 1500,
            MandaliId: new mongoose.Types.ObjectId("65a28c70bb9eb82394eeb811"),
            UserId: new mongoose.Types.ObjectId(ud._id.toString()),
          };
          list.push(body);
          let installment_detail = new Installment(body);
          await installment_detail.save();
        }
      }
      // console.log(list);
    }

    return res.status(201).json({
      statusMessage: "Installment create successfully",
      success: true,
    });
  } catch (error) {
    console.log(`Error in catch : ${error}`);
    return res.status(501).json({
      statusMessage: "Error in Create Installment",
      data: error,
      success: false,
    });
  }
};

module.exports = {
  add_member_migrate: add_member_migrate,
  create_installment_migrate: create_installment_migrate,
};
