const mongo = require("../database/database.service");
const schema = require("../database/database.schema");
const bcrypt = require("bcryptjs");
const SALT_WORK_FACTOR = 10;
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const User = schema.User;
const Mandali = schema.Mandali;
const Installment = schema.Installment;
const PendingInstallment = schema.Pending_installment;
const Penalty = schema.Penalty;
const Activity = schema.Activity;

let create_installment = async function (req, res) {
  let body = req.body;
  let data = {};
  try {
    if (!body.Penalty) {
      let [user_detail, installment_already_exist] = await Promise.all([
        User.aggregate([
          {
            $match: {
              MandaliId: new mongoose.Types.ObjectId(body.MandaliId),
            },
          },
          {
            $group: {
              _id: "",
              UserIdArray: {
                $push: "$_id",
              },
            },
          },
        ]),
        Installment.find({
          Month: Number(body.Month),
          Year: Number(body.Year),
        }),
      ]);
      if (installment_already_exist.length != 0) {
        return res.status(401).json({
          statusMessage:
            "Same date installment is already exist. Please enter valid date.",
          success: false,
        });
      }
      let installment_detail = new Installment(body);
      installment_detail.Remaining_users = user_detail[0].UserIdArray;

      let activity_details = new Activity();
      activity_details.UserId = body.UserId;
      activity_details.Detail = {
        Month: body.Month,
        Year: body.Year,
        Amount: body.Amount,
      };
      activity_details.ActivityType = "create_installment";

      await Promise.all([activity_details.save(), installment_detail.save()]);
    } else {
      let pending_installment = await Installment.aggregate([
        {
          $match: {
            Month: Number(body.Month),
            Year: Number(body.Year),
          },
        },
        {
          $project: {
            Remaining_users: "$Remaining_users",
          },
        },
      ]);

      if (
        pending_installment.length > 0 &&
        pending_installment[0].Remaining_users.length > 0
      ) {
        let penalty_entries = [];
        for (let d of pending_installment[0].Remaining_users) {
          let penalty = new Penalty(body);
          penalty.UserId = d;
          penalty_entries.push(penalty);
        }

        let activity_details = new Activity();
        activity_details.UserId = body.UserId;
        activity_details.Detail = {
          Month: body.Month,
          Year: body.Year,
          Amount: body.Amount,
        };
        activity_details.ActivityType = "create_penalty";

        await Promise.all([
          Installment.updateOne(
            { Month: Number(body.Month), Year: Number(body.Year) },
            { Remaining_users: [] }
          ),
          Penalty.insertMany(penalty_entries),
          activity_details.save(),
        ]);
      }
    }

    // if (body.UserType == "admin") {
    //   if (body.Penalty) {
    //     activity_details.ActivityType = "create_penalty";
    //     let penalty_detail = new Penalty(body);
    //     await penalty_detail.save();
    //   } else {
    //     let installment_detail = new Installment(body);
    //   }
    // } else {
    //   activity_details.ActivityType = body.Penalty
    //     ? "create_pending_penalty"
    //     : "create_pending_installment";
    //   let pending_installment = new PendingInstallment(body);
    //   await pending_installment.save();
    // }

    return res.status(201).json({
      statusMessage: body.Penalty
        ? "Penalty create successfully"
        : "Installment create successfully",
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

let read_remaining_installment = async function (req, res) {
  let body = req.body;
  let data = {};
  try {
    data.pending_installment = await Installment.aggregate([
      {
        $match: {
          MandaliId: new mongoose.Types.ObjectId(body.MandaliId),
        },
      },
      {
        $unwind: {
          path: "$Remaining_users",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "Remaining_users",
          foreignField: "_id",
          as: "user_detail",
        },
      },
      {
        $unwind: {
          path: "$user_detail",
        },
      },
      {
        $project: {
          Member_Name: "$user_detail.Username",
          Amount: {
            $multiply: ["$Amount", "$user_detail.NoOfAccount"],
          },
          Month: "$Month",
          Year: "$Year",
          UserId: "$Remaining_users",
        },
      },
    ]);
    return res.status(201).json({
      statusMessage: "Read Installment successfully",
      success: true,
      data: data,
    });
  } catch (error) {
    console.log(`Error in catch : ${error}`);
    return res.status(501).json({
      statusMessage: "Error in Installment Created",
      data: error,
      success: false,
    });
  }
};

let read_installment = async function (req, res) {
  let body = req.body;
  let data = {};
  data.monthly_installment = [];
  try {
    let [total_account, installment_detail] = await Promise.all([
      User.aggregate([
        {
          $match: {
            MandaliId: new mongoose.Types.ObjectId(body.MandaliId),
          },
        },
        {
          $group: {
            _id: "",
            NoOfAccount: {
              $sum: "$NoOfAccount",
            },
          },
        },
      ]),
      Installment.aggregate([
        {
          $match: {
            MandaliId: new mongoose.Types.ObjectId(body.MandaliId),
          },
        },
        {
          $sort: {
            createdAt: 1,
          },
        },
      ]),
    ]);

    let totalAccount =
      total_account.length > 0 ? total_account[0].NoOfAccount : 0;
    for (let d of installment_detail) {
      let transaction = {
        Month: d.Month,
        Year: d.Year,
        Total: d.Amount * totalAccount,
      };

      let pending_installment = await Installment.aggregate([
        {
          $match: {
            _id: d._id,
          },
        },
        {
          $unwind: {
            path: "$Remaining_users",
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "Remaining_users",
            foreignField: "_id",
            as: "user_detail",
          },
        },
        {
          $unwind: {
            path: "$user_detail",
          },
        },
        {
          $group: {
            _id: "",
            RemainingAmount: {
              $sum: {
                $multiply: ["$Amount", "$user_detail.NoOfAccount"],
              },
            },
          },
        },
      ]);

      transaction.Remaining =
        pending_installment.length > 0
          ? pending_installment[0].RemainingAmount
          : 0;
      transaction.Collected = transaction.Total - transaction.Remaining;

      data.monthly_installment.push(transaction);
    }

    return res.status(201).json({
      statusMessage: "Read Installment successfully",
      success: true,
      data: data,
    });
  } catch (error) {
    console.log(`Error in catch : ${error}`);
    return res.status(501).json({
      statusMessage: "Error in Installment Created",
      data: error,
      success: false,
    });
  }
};

let approve_delete_pending_request = async function (req, res) {
  let body = req.body;
  let bodyData = body.data;
  try {
    let StartDate = new Date();
    StartDate.setUTCHours(0, 0, 0, 0);
    StartDate.setDate(1);
    StartDate.setMonth(bodyData.Month);
    StartDate.setFullYear(bodyData.Year);

    let activity_details = new Activity();
    activity_details.UserId = body.UserId;
    activity_details.ActivityType = "approve_pending_request";
    activity_details.Detail = {
      Username: bodyData.Member_Name,
      Date: StartDate,
      transactionType: "Installment",
    };

    await Installment.updateOne(
      { _id: bodyData._id },
      { $pull: { Remaining_users: bodyData.UserId } }
    );

    return res.status(201).json({
      statusMessage: "Approve transaction successfully",
      success: true,
      data: {},
    });
  } catch (error) {
    console.log(`Error in catch : ${error}`);
    return res.status(501).json({
      statusMessage: "Error in Approve Delete Pending Installment",
      data: error,
      success: false,
    });
  }
};

module.exports = {
  create_installment: create_installment,
  read_installment: read_installment,
  read_remaining_installment: read_remaining_installment,
  approve_delete_pending_request: approve_delete_pending_request,
};
