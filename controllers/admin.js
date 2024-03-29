const mongo = require("../database/database.service");
const schema = require("../database/database.schema");
const bcrypt = require("bcryptjs");
const SALT_WORK_FACTOR = 10;
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const decrypt = require("./decryption");
const Cryptr = require("cryptr");

const User = schema.User;
const Mandali = schema.Mandali;
const Activity = schema.Activity;
const Installment = schema.Installment;
const Penalty = schema.Penalty;
const Stock = schema.Stock;
const Realized = schema.Realized;

let add_user = async function (req, res) {
  let body = req.body;
  let data = {};
  try {
    let user = body;
    user.Password = bcrypt.hashSync(user.Password, SALT_WORK_FACTOR);
    user.IsLoginAble = true;
    user.UserType = body.IsAdmin ? "admin" : "member";
    user.Username = body.FirstName + " " + body.LastName;
    user = new User(user);

    let activity_details = new Activity();
    activity_details.UserId = body.AdminId;
    activity_details.ActivityType = "add_member";
    activity_details.Detail = {
      Username: user.Username,
    };

    await Promise.all([user.save(), activity_details.save()]);

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

let read_user = async function (req, res) {
  let body = req.body;
  let data = {};
  try {
    [data.UserDetails, data.RemainingInstallment] = await Promise.all([
      User.aggregate([
        {
          $match: {
            MandaliId: new mongoose.Types.ObjectId(body.MandaliId),
          },
        },
        {
          $lookup: {
            from: "installments",
            localField: "MandaliId",
            foreignField: "MandaliId",
            as: "installment_detail",
          },
        },
        {
          $unwind: {
            path: "$installment_detail",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $group: {
            _id: "$_id",
            Username: {
              $first: "$Username",
            },
            ContactNumber: {
              $first: "$ContactNumber",
            },
            Email: {
              $first: "$Email",
            },
            NoOfAccount: {
              $first: "$NoOfAccount",
            },
            TotalInvestment: {
              $sum: {
                $multiply: ["$NoOfAccount", "$installment_detail.Amount"],
              },
            },
            createdAt: {
              $first: "$createdAt",
            },
          },
        },
        {
          $lookup: {
            from: "penalties",
            localField: "_id",
            foreignField: "UserId",
            as: "penalty_detail",
          },
        },
        {
          $unwind: {
            path: "$penalty_detail",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $group: {
            _id: "$_id",
            Username: {
              $first: "$Username",
            },
            ContactNumber: {
              $first: "$ContactNumber",
            },
            Email: {
              $first: "$Email",
            },
            NoOfAccount: {
              $first: "$NoOfAccount",
            },
            TotalInvestment: {
              $first: "$TotalInvestment",
            },
            TotalPenalty: {
              $sum: { $ifNull: ["$penalty_detail.Amount", 0] },
            },
            createdAt: {
              $first: "$createdAt",
            },
          },
        },
        {
          $sort: {
            createdAt: 1,
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
          $unwind: {
            path: "$Remaining_users",
          },
        },
      ]),
    ]);

    for (let i = 0; i < data.UserDetails.length; i++) {
      for (let j = 0; j < data.RemainingInstallment.length; j++) {
        if (
          data.UserDetails[i]._id.toString() ==
          data.RemainingInstallment[j].Remaining_users.toString()
        ) {
          data.UserDetails[i].TotalInvestment -=
            data.RemainingInstallment[j].Amount;
        }
      }
    }

    data.TotalAccount = data.UserDetails.reduce(
      (acc, cur) => acc + (cur.NoOfAccount ? cur.NoOfAccount : 0),
      0
    );
    return res.status(201).json({
      statusMessage: " User Profile Read successfully",
      success: true,
      data: data,
    });
  } catch (error) {
    console.log(`Error in catch : ${error}`);
    return res.status(501).json({
      statusMessage: "Error in read user",
      data: error,
      success: false,
    });
  }
};

let calculate_current_investment = async function (body) {
  let data = {
    current_investment: 0,
    total_charge: 0,
    profitLoss: 0,
  };
  try {
    let [buy_stock, sell_stock] = await Promise.all([
      Stock.aggregate([
        {
          $match: {
            MandaliId: new mongoose.Types.ObjectId(body.MandaliId),
          },
        },
        {
          $unwind: {
            path: "$Transaction",
          },
        },
        {
          $project: {
            Symbol: "$Symbol",
            Date: "$Transaction.Date",
            Exchange: "$Exchange",
            MandaliId: "$MandaliId",
            StockName: "$StockName",
            MandaliId: "$MandaliId",
            createdAt: "$createdAt",
            updatedAt: "$updatedAt",
            Amount: "$Transaction.Amount",
            Quantity: "$Transaction.Quantity",
          },
        },
      ]),
      Realized.aggregate([
        {
          $match: {
            MandaliId: new mongoose.Types.ObjectId(body.MandaliId),
          },
        },
        {
          $unwind: {
            path: "$Transaction",
          },
        },
        {
          $project: {
            Symbol: "$Symbol",
            Date: "$Transaction.Date",
            Exchange: "$Exchange",
            MandaliId: "$MandaliId",
            StockName: "$StockName",
            MandaliId: "$MandaliId",
            createdAt: "$createdAt",
            updatedAt: "$updatedAt",
            Amount: "$Transaction.Amount",
            Quantity: "$Transaction.Quantity",
            Charge: "$Transaction.Charge",
          },
        },
      ]),
    ]);

    for (let sell of sell_stock) {
      data.total_charge += sell.Charge ? sell.Charge : 0;
      for (let i = 0; i < buy_stock.length; i++) {
        if (sell.Symbol == buy_stock[i].Symbol) {
          if (sell.Quantity <= buy_stock[i].Quantity) {
            let matchQuantity = sell.Quantity;
            data.profitLoss +=
              matchQuantity * (sell.Amount - buy_stock[i].Amount);
            buy_stock[i].Quantity -= matchQuantity;
            sell.Quantity -= matchQuantity;
            break;
          } else {
            let matchQuantity = buy_stock[i].Quantity;
            data.profitLoss +=
              matchQuantity * (sell.Amount - buy_stock[i].Amount);
            buy_stock[i].Quantity -= matchQuantity;
            sell.Quantity -= matchQuantity;
            continue;
          }
        }
      }
    }

    for (let bs of buy_stock) {
      data.current_investment += bs.Quantity * bs.Amount;
    }
    return data;
  } catch (error) {
    console.log(`Error in catch : ${error}`);
    return 0;
  }
};

let calculate_installment = async function (body) {
  let data = {
    TotalInstallment: 0,
  };
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
      let Total = d.Amount * totalAccount;

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

      let Remaining =
        pending_installment.length > 0
          ? pending_installment[0].RemainingAmount
          : 0;
      data.TotalInstallment += Total - Remaining;
    }

    return data;
  } catch (error) {
    console.log(`Error in catch : ${error}`);
  }
};

let read_dashboard = async function (req, res) {
  let body = req.body;
  let data = {};
  try {
    let [user_detail, penalty_detail] = await Promise.all([
      User.aggregate([
        {
          $match: {
            MandaliId: new mongoose.Types.ObjectId(body.MandaliId),
          },
        },
        {
          $group: {
            _id: "$MandaliId",
            total_account: {
              $sum: "$NoOfAccount",
            },
            total_member: {
              $sum: 1,
            },
          },
        },
      ]),
      User.aggregate([
        {
          $match: {
            MandaliId: new mongoose.Types.ObjectId(body.MandaliId),
          },
        },
        {
          $lookup: {
            from: "penalties",
            localField: "_id",
            foreignField: "UserId",
            as: "penalty",
          },
        },
        {
          $unwind: {
            path: "$penalty",
          },
        },
        {
          $group: {
            _id: "",
            total_penalty: {
              $sum: "$penalty.Amount",
            },
          },
        },
      ]),
    ]);

    let installment_detail = await calculate_installment({
      MandaliId: body.MandaliId,
    });
    data.TotalInvestment = installment_detail.TotalInstallment
      ? installment_detail.TotalInstallment
      : 0;
    data.TotalMember = user_detail.length > 0 ? user_detail[0].total_member : 0;
    data.TotalAccount =
      user_detail.length > 0 ? user_detail[0].total_account : 0;
    data.TotalPenalty =
      penalty_detail.length > 0 ? penalty_detail[0].total_penalty : 0;

    let investment_calculation = await calculate_current_investment(body);
    data.CurrentInvestment = investment_calculation.current_investment;
    data.TotalProfitLoss = investment_calculation.profitLoss;

    data.BankBalance =
      data.TotalInvestment +
      data.TotalProfitLoss +
      data.TotalPenalty -
      data.CurrentInvestment -
      investment_calculation.total_charge;

    return res.status(201).json({
      statusMessage: " Dashboard read successfully",
      success: true,
      data: data,
    });
  } catch (error) {
    console.log(`Error in catch : ${error}`);
    return res.status(501).json({
      statusMessage: "Error in read dashboard",
      data: error,
      success: false,
    });
  }
};

module.exports = {
  add_user: add_user,
  read_user: read_user,
  read_dashboard: read_dashboard,
};
