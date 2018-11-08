var mongoose = require("mongoose");

var Task = mongoose.model("task", {
  content: {
    type: String,
    required: true,
    minlength: 1,
    trim: true
  },
  day: {
    type: Number,
    default: null,
    min: [0, 'Day may not be < 0'],
    max: [6, 'Day may not be > 6']
  },
  done: {
    type: Boolean,
    default: false
  },
  doneAt: {
    type: Number,
    default: null
  },
  frame: {
    type: String,
    required: true,
    minlength: 5,
    maxlength: 6,
    trim: true
  },
  color: {
    type: Number,
    default: 0,
    min: [0, 'Color may not be < 0'],
    max: [15, 'Color may not be > 15']
  },
  _user: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  }
});

module.exports = {Task};
