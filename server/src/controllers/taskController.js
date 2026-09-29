const mongoose = require("mongoose");
const Task = require("../models/Task");
const { validateTaskPayload } = require("../utils/taskValidation");

function isValidationError(error) {
  return error instanceof mongoose.Error.ValidationError ||
    error instanceof mongoose.Error.ValidatorError;
}

function getTaskFilter(req, taskId) {
  const filter = {
    _id: taskId
  };

  if (req.user.role !== "admin") {
    filter.author = req.user._id;
  }

  return filter;
}

async function getAllTasks(req, res) {
  try {
    const filter = req.user.role === "admin"
      ? {}
      : { author: req.user._id };

    const tasks = await Task.find(filter).sort({ createdAt: -1 });

    return res.status(200).json(tasks);
  } catch {
    return res.status(500).json({
      error: "Unable to retrieve tasks"
    });
  }
}

async function getTaskById(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        error: "Invalid task ID"
      });
    }

    const task = await Task.findOne(
      getTaskFilter(req, req.params.id)
    );

    if (!task) {
      return res.status(404).json({
        error: "Task not found"
      });
    }

    return res.status(200).json(task);
  } catch {
    return res.status(500).json({
      error: "Unable to retrieve task"
    });
  }
}

async function createTask(req, res) {
  const validation = validateTaskPayload(req.body);
  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const task = await Task.create({
      ...validation.values,
      author: req.user._id
    });

    return res.status(201).json(task);
  } catch (error) {
    if (isValidationError(error)) {
      return res.status(400).json({ error: "Task fields are invalid" });
    }
    return res.status(500).json({
      error: "Unable to create task"
    });
  }
}

async function updateTask(req, res) {
  const validation = validateTaskPayload(req.body, { partial: true });
  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        error: "Invalid task ID"
      });
    }

    const task = await Task.findOneAndUpdate(
      getTaskFilter(req, req.params.id),
      validation.values,
      {
        new: true,
        runValidators: true
      }
    );

    if (!task) {
      return res.status(404).json({
        error: "Task not found"
      });
    }

    return res.status(200).json(task);
  } catch (error) {
    if (isValidationError(error)) {
      return res.status(400).json({ error: "Task fields are invalid" });
    }
    return res.status(500).json({
      error: "Unable to update task"
    });
  }
}

async function deleteTask(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        error: "Invalid task ID"
      });
    }

    const task = await Task.findOneAndDelete(
      getTaskFilter(req, req.params.id)
    );

    if (!task) {
      return res.status(404).json({
        error: "Task not found"
      });
    }

    return res.status(200).json({
      message: "Task deleted successfully"
    });
  } catch {
    return res.status(500).json({
      error: "Unable to delete task"
    });
  }
}

module.exports = {
  getAllTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask
};
