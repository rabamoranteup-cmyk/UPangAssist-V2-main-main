const mongoose = require("mongoose");
const {
  TASK_TITLE_MAX_LENGTH,
  TASK_DESCRIPTION_MAX_LENGTH
} = require("../utils/taskValidation");

const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: TASK_TITLE_MAX_LENGTH
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: TASK_DESCRIPTION_MAX_LENGTH
    },
    completed: {
      type: Boolean,
      default: false
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  },
  {
    timestamps: true 
  }
);

module.exports = mongoose.model("Task", taskSchema);
