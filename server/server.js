require("./config/config.js");

const _ = require('lodash');
const express = require('express');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const uuidv1 = require('uuid/v1');

const {ObjectID} = require("mongodb");
const mongoose = require('./db/mongoose'); //This line is needed in order to initialize DB connection 

var {Task} = require("./models/task");
var {User} = require("./models/user");
var {authenticate} = require("./middleware/authenticate");
var {sendResetPasswordMail} = require("./tools/EmailSender")

var app = express();
const port = process.env.PORT;

app.use(bodyParser.json());
app.use(helmet());

//TODO DO NOT ALLOW CROSS ORIGIN IN PRODUCTION
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, x-auth, Content-Type, Accept");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", 'DELETE, PUT, GET, POST, PATCH');
  res.header("Access-Control-Expose-Headers",  "x-auth");
  next();
});

app.post("/tasks", authenticate, (req, res) => {

  Task.find({dueAt: req.body.dueAt}).then((otherTasks) => {
    var task = new Task({
      content: req.body.content,
      position: otherTasks.length,
      _user: req.user._id, //We have acces to the user because of our middleware function authenticate
      reoccuring: req.body.reoccuring,
      dueAt: req.body.dueAt,
      color: req.body.color
    });
    task.save().then((doc) => {
      res.send(doc);
    }, (e) => {
      res.status(400).send(e);
    })
  });
});

app.get("/tasks", authenticate, (req, res) => {
  let filter = {
    _user: req.user._id,
  };

  if(req.query.done != undefined){
    filter.done = req.query.done;
  }

  if(req.query.dueAt != undefined){
    filter.dueAt = req.query.dueAt;
  }

  Task.find(filter).then((tasks) => {
    res.send({
      tasks
    });
  }, (e) => {
    res.send(400).send(e);
  });
});

app.get("/tasks/:id", authenticate, (req, res) => {
  var id = req.params.id;

  if(!ObjectID.isValid(id)){
    res.status(404).send();
  }

  Task.findOne({
    _id: id,
    _user: req.user._id
  }).then((task) => {
    if(!task){
      return res.status(404).send();
    }
    res.send({task});
  }, (e) => {
    res.status(400).send(e);
  });
});

app.delete("/tasks/:id", authenticate, async(req, res) => {

  try{
    var id = req.params.id;
    if(!ObjectID.isValid(id)){
      return res.status(404).send();
    }

    const task = await Task.findOneAndRemove({
      _id: id,
      _user: req.user._id
    });

    if(!task){
      return res.status(404).send();
    }

    //Decrement position for all task that are in the same day and to the right of the one that was deleted
    Task.updateMany({dueAt: task.dueAt, position: { $gt: task.position }}, {$inc: { position: -1}}, {new: true, runValidators: true}).then((task) => {
      if(!task){
        return res.status(404).send();
      }
    }).catch((e) => {
      return res.status(400).send({error: e});
    });


    res.send({task});

  } catch(e) {
    res.status(400).send(e);
  }
});

app.patch("/tasks/:id", authenticate, (req, res) => {
  var id = req.params.id;
  var body = _.pick(req.body, ["content", "dueAt", "reoccuring", "done", "position", "color"]);

  if(!ObjectID.isValid(id)){
    return res.status(404).send();
  }

  if(_.isBoolean(body.done) && body.done){
    body.doneAt = new Date().getTime();
  } else {
    body.done = false;
    body.doneAt = null;
  }

  Task.findOneAndUpdate({_id: id, _user: req.user._id}, {$set: body}, {new: true, runValidators: true}).then((task) => {

    if(!task){
      res.status(404).send();
    }
    res.send({task});

  }).catch((e) => {
    res.status(400).send({error: e});
  });

})

app.patch("/taskspositions", authenticate, (req, res) => {
  const body = _.pick(req.body, ["positions"]);
  body.positions.forEach((position) => {
    Task.findOneAndUpdate({_id: position.id, _user: req.user._id}, {$set: position}, {new: true, runValidators: true}).then((task) => {
      if(!task){
        return res.status(404).send();
      }
    }).catch((e) => {
      return res.status(400).send({error: e});
    });
    res.status(200).send();
  })
})

app.patch("/taskposition", authenticate, (req, res) => {

  const body = _.pick(req.body, ["id", "position", "dueAt"]);

  //Decrease position of each task that was behind the one that was moved
  let originalDueAt;
  let originalPosition;
  Task.findOne({_user: req.user._id, _id: body.id}).then((task) => {

    originalDueAt = task.dueAt;
    originalPosition = task.position;

    Task.updateMany({dueAt: originalDueAt, position: { $gt: originalPosition }}, {$inc: { position: -1}}, {new: true, runValidators: true}).then((task) => {
      if(!task){
        return res.status(404).send();
      }
    }).catch((e) => {
      return res.status(400).send({error: e});
    });
  });

  //Increase position of each task that is next in line after the one that was moved
  Task.updateMany({_user: req.user._id, dueAt: body.dueAt, position: { $gte: body.position }}, {$inc: { position: 1}}, {new: true, runValidators: true}).then((task) => {
    if(!task){
      return res.status(404).send();
    }
  }).catch((e) => {
    return res.status(400).send({error: e});
  });

  //Update the position and dueAt properties of the task that was moved
  Task.findOneAndUpdate({_user: req.user._id, _id: body.id}, {$set: {position: body.position, dueAt: body.dueAt}}, {new: true, runValidators: true}).then((task) => {
    if(!task){
      return res.status(404).send();
    }
  }).catch((e) => {
    return res.status(400).send({error: e});
  });

  res.status(200).send();
})

app.post("/users", async (req, res) => {

  try {
    var body = _.pick(req.body, ["email", "password"]);
    var user = new User(body);
    await user.save();
    const token = await user.generateAuthToken();
    res.header("x-auth", token).send(user);

  } catch(e) {
    res.status(400).send(e);
  }

});

app.get("/users/me", authenticate, (req, res) => {
  res.send(req.user);
});

app.post("/users/login", async (req, res) => {
  try {
    const body = _.pick(req.body, ["email", "password"]);
    const user = await User.findByCredentials(body.email, body.password);
    const token = await user.generateAuthToken();
    res.header("x-auth", token).send(user);
  } catch(e) {
    res.status(400).send(e);
  }
});

app.post("/users/newpassword", async (req, res) => {

  try {
    const body = _.pick(req.body, ["resetcode", "password"]);
    const user = await User.findByResetcode(body.resetcode);

    if(user.resetdeadline < Date.now()){
      return res.status(401).send();
    }

    user.password = body.password;
    user.resetcode = null;
    user.resetdeadline = null;

    await user.save();
    res.status(200).send();

  } catch(e) {
    res.status(400).send(e);
  }
});

app.patch("/users/updatepassword", authenticate, async (req, res) => {

  try {
    const body = _.pick(req.body, ["oldpassword", "newpassword"]);

    let email = req.user.email;


    let user = await User.findByCredentials(email, body.oldpassword);

    if(!user){
      return res.status(400).send();
    }


    user.password = body.newpassword;
    user.resetcode = null;
    user.resetdeadline = null;

    const token = await user.generateAuthToken();
    res.header("x-auth", token).send(user);

    res.status(200).send();

  } catch(e) {
    res.status(400).send(e);
  }
});

app.patch("/users/updateemail", authenticate, async (req, res) => {
  try {
    const body = _.pick(req.body, ["newemail", "password"]);

    let user = req.user;
    let userByCredentials = await User.findByCredentials(user.email, body.password);

    if(!userByCredentials) res.status(400).send();

    user.email = body.newemail;

    const token = await user.generateAuthToken();
    res.header("x-auth", token).send(user);

    res.status(200).send();
  } catch(e) {
    res.status(400).send(e);
  }
});

app.delete("/users/me/token", authenticate, async (req, res) => {
  try{
    await req.user.removeToken(req.token);
    res.status(200).send();
  } catch (e) {
    res.status(400).send(e);
  }
});

app.post("/users/resetpassword", async (req, res) => {
  try {
    const body = _.pick(req.body, ["email"]);
    let user = await User.findByEmail(body.email);

    const resetcode = uuidv1();
    const resetdeadline = Date.now() + 60*1000*60;

    await User.findOneAndUpdate({email: user.email}, {$set: {resetcode, resetdeadline}}, {new: true, runValidators: true});
    sendResetPasswordMail(user.email, resetcode, req);
    res.status(200).send();

  } catch (e) {
    res.status(400).send(e);
  }
});

app.listen(port, () => {
  console.log("Started server on port ", port);
});


//Task Manager


module.exports = {app};
