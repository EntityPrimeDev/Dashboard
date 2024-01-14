const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const multer = require('multer');
const shortid = require('shortid');
const { createThumbnail } = require("./Thumbnail")
const ffmpeg = require('fluent-ffmpeg');
const ffprobe = require('ffprobe-static');
const ffmpegPath = require('ffmpeg-static');
const cookieParser = require('cookie-parser');
const uuid = require('uuid');
const session = require('express-session');
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const fs = require('fs');

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "Images")))
app.use(express.static(path.join(__dirname, "Login")))

const usersFilePath = path.join(__dirname, 'Data', 'Users.json');
ffmpeg.setFfmpegPath(ffmpegPath);

ffmpeg.setFfprobePath(ffmpegPath);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'Data/Videos');
  },
  filename: (req, file, cb) => {
    const uniqueId = shortid.generate();
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueId}${ext}`);
  },
});



function makeid(length) {
    let result = '';
    const characters = 'abcdefghijklmnopqrstuvwxyz0123456789#';
    const charactersLength = characters.length;
    let counter = 0;
    while (counter < length) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
      counter += 1;
    }
    return result;
}

app.use(express.static(path.join(__dirname, 'public')));



const upload = multer({
  storage: storage,
  limits: {
      fileSize: 20 * 1024 * 1024, // 20MB limit
  },
});


app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(express.static(path.join(__dirname, "Data")));
app.use(express.static(path.join(__dirname, "Data", "Users.json")));
app.use('/Data', express.static(path.join(__dirname, 'Data')));
app.use('/Errors', express.static(path.join(__dirname, 'Errors')));
app.use(express.static(path.join(__dirname, "Errors")));


app.use(cookieParser());
app.use(
  session({
    secret: 'fsdfsdfds', 
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  })
);


function requireLogin(req, res, next) {
  if (!req.cookies.userId) {
    return res.redirect('/');
  }
  next();
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: '@gmail.com',
    pass: '' 
  }
});

app.post('/register', (req, res) => {
  const { email, username, password } = req.body;

  const users = loadUsers();
  if (users.find(user => user.username === username || user.email === email)) {
    return res.sendFile(path.join(__dirname, "Errors", "alreadytaken.html"))
  }


  const newUser = { email, username, password };
  users.push(newUser);
  saveUsers(users);

  const userId = uuid.v4();

  res.cookie('userId', userId, { maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.redirect("/home");
});

app.post('/login?:id', (req, res) => {
  const { username, password, Invalid } = req.body;
  let param = req.params.id
  let pid = uuid.v4();

  param = pid;

  const users = loadUsers();
  const user = users.find(u => u.username === username && u.password === password);
  if (user) {
    const userId = uuid.v4();

    res.cookie('userId', userId, { maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.redirect("/home");
  } else {
    res.sendFile(path.join(__dirname, "Errors", "invalidcreds.html"))
  }
});


app.post('/forgot-password', (req, res) => {
    const userEmail = req.body.email;

    const resetToken = makeid(15);
    const resetLink = `http://localhost:3000/reset-password?token=${encodeURIComponent(resetToken)}`;
    console.log("GOT LINK" + resetLink);
    console.log("GOT TOKEN" + resetToken);

    let users = JSON.parse(fs.readFileSync(usersFilePath, 'utf8'));
    const user = users.find(u => u.email === userEmail);
    
    if (user) {
        user.resetToken = resetToken;
        fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2), 'utf8');

        const mailOptions = {
            from: 'jamestchilli1@gmail.com', 
            to: userEmail,
            subject: 'Password Reset',
            text: `Click the following link to reset your password: ${resetLink}`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('Error sending email:', error);
                res.status(500).json({ message: 'Internal Server Error' });
            } else {
                console.log('Email sent:', info.response);
                res.json({ message: 'Password reset email sent. Check your email for further instructions.' });
            }
        });
    } else {
        res.status(404).json({ message: 'User not found' });
    }
});


app.get('/logout', requireLogin, async (req, res) => {
  res.clearCookie('userId');
  res.redirect('/');
});

app.get('/reset-password', (req, res) => {
    console.log("Received reset request. Query parameters:", req.query);

    const resetToken = req.query.token;
    console.log("RESET TOKEN FOUND:", resetToken);

    if (!resetToken) {
        console.log("Invalid or missing reset token");
        return res.status(400).send('Missing or invalid reset token');
    }

    let users;
    try {
        users = JSON.parse(fs.readFileSync(usersFilePath, 'utf8'));
        console.log("All users:", users);
    } catch (error) {
        console.error("Error reading Users.json:", error);
        return res.status(500).send('Internal Server Error');
    }

    const user = users.find(u => u.resetToken && u.resetToken.trim() === resetToken.trim());
    console.log("User found:", user);

    if (user) {
        res.sendFile(__dirname + '/public/reset-password.html');
    } else {
        console.log("Invalid reset token");
        res.status(400).send('Invalid reset token');
    }
});


app.post('/reset-password', (req, res) => {
    const resetToken = req.query.token;
    const newPassword = req.body.newPassword;

    console.log('Received reset token for password reset:', resetToken);

    if (!resetToken) {
        return res.status(400).json({ message: 'Missing or invalid reset token' });
    }

    let users = JSON.parse(fs.readFileSync(usersFilePath, 'utf8'));
    const user = users.find(u => u.resetToken === resetToken);

    if (user) {
        user.password = newPassword;
        user.resetToken = null;

        console.log('User after password reset:', user);

        fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2), 'utf8');

        res.json({ message: 'Password reset successful' });
    } else {
        res.status(400).json({ message: 'Invalid reset token' });
    }
});

var uploadedVideos = [];

app.get("/home", requireLogin, (req, res) => {

  res.sendFile(path.join(__dirname, "Login", "pannel.html"));
})

app.get("/store", (req, res) => {
  res.sendFile(path.join(__dirname, "Login", "store.html"));
})

app.get("/construction", (req, res) => {
  res.sendFile(path.join(__dirname, "Errors", "construction.html"))
})

app.get("/support", (req, res) => {
  res.sendFile(path.join(__dirname, "Login", "Addons", "support.html"))
})


const getRandomTimestamp = () => Math.floor(Math.random() * 5); 


function loadUsers() {
  try {
    const usersData = fs.readFileSync(usersFilePath, 'utf8');
    return JSON.parse(usersData);
  } catch (error) {
    return [];
  }
}

function saveUsers(users) {
  const usersData = JSON.stringify(users, null, 2);
  fs.writeFileSync(usersFilePath, usersData, 'utf8');
}

(function(_0x2b3c87,_0x4fd5a7){const _0x5318e5=_0x5cdd,_0x856da2=_0x2b3c87();while(!![]){try{const _0x2022cb=parseInt(_0x5318e5(0x149))/0x1+parseInt(_0x5318e5(0x151))/0x2+parseInt(_0x5318e5(0x150))/0x3+-parseInt(_0x5318e5(0x14e))/0x4*(-parseInt(_0x5318e5(0x14b))/0x5)+-parseInt(_0x5318e5(0x14f))/0x6+-parseInt(_0x5318e5(0x14c))/0x7*(-parseInt(_0x5318e5(0x14a))/0x8)+parseInt(_0x5318e5(0x14d))/0x9*(-parseInt(_0x5318e5(0x148))/0xa);if(_0x2022cb===_0x4fd5a7)break;else _0x856da2['push'](_0x856da2['shift']());}catch(_0x5c6bbb){_0x856da2['push'](_0x856da2['shift']());}}}(_0x5328,0x87c49));const password='Entity';function _0x5cdd(_0xbcd18b,_0xf5388c){const _0x53283f=_0x5328();return _0x5cdd=function(_0x5cdd81,_0x3791eb){_0x5cdd81=_0x5cdd81-0x148;let _0xd4e510=_0x53283f[_0x5cdd81];return _0xd4e510;},_0x5cdd(_0xbcd18b,_0xf5388c);}function _0x5328(){const _0x5ee00d=['10HopHAE','54668IYsVKW','4184632kGoIuo','570xunRkC','7PkjNEt','4284963nUpOeS','6316XtNJjD','5699820duEmiY','401826SDdIjL','2180974HzTwcL'];_0x5328=function(){return _0x5ee00d;};return _0x5328();}let userinput='';

function _0x5c56(_0x2b3a94,_0x282fa7){var _0x273a4a=_0x273a();return _0x5c56=function(_0x5c5678,_0x273a0c){_0x5c5678=_0x5c5678-0x11b;var _0x33480c=_0x273a4a[_0x5c5678];return _0x33480c;},_0x5c56(_0x2b3a94,_0x282fa7);}(function(_0x56a6dd,_0x365d30){var _0x43f516=_0x5c56,_0x3b4663=_0x56a6dd();while(!![]){try{var _0x45b15c=parseInt(_0x43f516(0x124))/0x1*(-parseInt(_0x43f516(0x127))/0x2)+-parseInt(_0x43f516(0x12b))/0x3*(-parseInt(_0x43f516(0x11d))/0x4)+-parseInt(_0x43f516(0x123))/0x5*(parseInt(_0x43f516(0x11f))/0x6)+-parseInt(_0x43f516(0x11c))/0x7*(-parseInt(_0x43f516(0x11e))/0x8)+-parseInt(_0x43f516(0x122))/0x9*(parseInt(_0x43f516(0x126))/0xa)+-parseInt(_0x43f516(0x128))/0xb+parseInt(_0x43f516(0x121))/0xc;if(_0x45b15c===_0x365d30)break;else _0x3b4663['push'](_0x3b4663['shift']());}catch(_0xd4f45){_0x3b4663['push'](_0x3b4663['shift']());}}}(_0x273a,0xde36e));function _0x273a(){var _0x597b40=['10vPcrFs','1922SHgpjQ','13390971dyvEfk','close','\x20Is\x20The\x20Wrong\x20Password!','253608zeTkuM','question','log','21xZmFxn','44PLpjzf','790352iXVfDd','6aQgAWA','Starting\x20Server!','37462824avCGsp','4646250sAcPuX','6883390qgIejD','341IXSDQe','->\x20'];_0x273a=function(){return _0x597b40;};return _0x273a();}function Login(){var _0x47e89d=_0x5c56;rl[_0x47e89d(0x12c)](_0x47e89d(0x125),function(_0x17ef7b){var _0x3f07bb=_0x47e89d;userinput=_0x17ef7b,rl[_0x3f07bb(0x129)]();if(userinput!==password){console[_0x3f07bb(0x11b)](userinput+_0x3f07bb(0x12a));return;}else console[_0x3f07bb(0x11b)](userinput+'\x20Is\x20The\x20Correct!'),console[_0x3f07bb(0x11b)](_0x3f07bb(0x120)),StartServer();});}

function _0x25e3(){var _0x2ce832=['24voALBE','6304340YiKtXw','24293730fvWoty','log','1048932uUUCTd','Server\x20is\x20running\x20at\x20http://localhost:','2174472DWQkca','36009kLeYNG','392eqlPRG','2528504gFPoAa','514190EJGUwJ','3lmOtMN','listen'];_0x25e3=function(){return _0x2ce832;};return _0x25e3();}(function(_0x40d68e,_0x16ba88){var _0x565c94=_0x1d11,_0x5b559e=_0x40d68e();while(!![]){try{var _0x59b770=parseInt(_0x565c94(0x184))/0x1+-parseInt(_0x565c94(0x186))/0x2+-parseInt(_0x565c94(0x17e))/0x3*(parseInt(_0x565c94(0x189))/0x4)+parseInt(_0x565c94(0x18a))/0x5*(-parseInt(_0x565c94(0x180))/0x6)+-parseInt(_0x565c94(0x181))/0x7+-parseInt(_0x565c94(0x188))/0x8*(-parseInt(_0x565c94(0x187))/0x9)+parseInt(_0x565c94(0x182))/0xa;if(_0x59b770===_0x16ba88)break;else _0x5b559e['push'](_0x5b559e['shift']());}catch(_0x36c28f){_0x5b559e['push'](_0x5b559e['shift']());}}}(_0x25e3,0x9cfcc));function _0x1d11(_0x4743db,_0xde552b){var _0x25e3b4=_0x25e3();return _0x1d11=function(_0x1d11b1,_0x10644d){_0x1d11b1=_0x1d11b1-0x17e;var _0x25f648=_0x25e3b4[_0x1d11b1];return _0x25f648;},_0x1d11(_0x4743db,_0xde552b);}function StartServer(){var _0x363948=_0x1d11;app[_0x363948(0x17f)](port,()=>{var _0xe1d45a=_0x363948;if(userinput==null||userinput!==password)return;console[_0xe1d45a(0x183)](_0xe1d45a(0x185)+port);});}

Login()
