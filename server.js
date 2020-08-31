var mysql = require('mysql');
var express = require('express');
var session = require('express-session');
var bodyParser = require('body-parser');
var path = require('path');
var flash = require('express-flash');
var cassandra = require('cassandra-driver');
var http = require('http').Server(app);
var io = require('socket.io')(http);

//set up db connection for mysql (user db)
var db_connection = mysql.createConnection({
    host: '35.234.144.155',
    user: 'root',
    password: 'password',
    database: 'Accounts'
});

//set up db connection to cassandra (messaging service)
var cass_client = new cassandra.Client({
    contactPoints: ['35.189.68.169:9042'], 
    localDataCenter: 'datacenter1',
    keyspace: 'messaging'
    });
    cass_client.connect(function (error) {
    if (error) throw error;
});



//using express and its packages
var app = express();

app.use(express.urlencoded({
    extended: true
  }))

app.use(session({
    secret: 'secret',
    resave: true,
    saveUninitialized: true
}));
app.use(bodyParser.urlencoded({extended:true}));
app.use(bodyParser.json());
app.use(express.static(__dirname));
app.use(flash());
//app.dynamicHelpers({flash: function(req, res){return req.flash();}});

//array to store online users
var online = [];

//show login.html to user
app.get('/login', function(request, response){
    response.sendFile(path.join(__dirname + '/server.html'));
});

app.post('/login', function(request, response){
    var username = request.body.username;
    var password = request.body.password;

    var sql = "SELECT * FROM `Users` WHERE `username`='"+username+"' and password = '"+password+"'";
    db_connection.query(sql, function(error, results, fields)
        {
            if (error) throw error;
            if (results.length > 0)
                {
                    request.session.loggedin = true;
                    request.session.username = username;
                    online.push(username);
                    response.redirect('/home');
                }
            else
                {
                    response.send('Username and/or password is incorrect');
                }   
        });
});

app.post('/logout', function(request, response){
    request.session.loggedin = false;
    request.session.username = username;
    response.redirect('/login');
});

app.get('/home', function(request, response)
{
    response.render(path.join(__dirname + '/home.ejs'), {username: request.session.username});
});

//showing register page
app.get('/register', function(request, response){
    response.sendFile(path.join(__dirname + '/register.html'));
});

//sending data to database
app.post('/register', function(request, response){
    var username = request.body.username;
    var password = request.body.password;
    var email = request.body.email;
    if(request.body.helper)
    {
        var helper = 1;
    }
    else
    {
        var helper = 0;
    }
    if(request.body.helped)
    {
        var helped = 1;
    }
    else{
        var helped = 0;
    }

    console.log(helper, helped);

    //check if user already exists
    var sql = "SELECT * FROM `Users` WHERE `username`='"+username+"'";
    db_connection.query(sql, function(error, results, fields)
    {
        if(error) {throw error};
        if (results.length > 0)
        {
            //require.flash('usermessage', 'Username already in use');
            response.send('Username is already taken');
        }
        else
        {
            //inserting into db
            var sql = "INSERT INTO `Users`(username, password, email, helper, helped) VALUES (?, ?, ?, ?, ?)";
            db_connection.query(sql,[username, password, email, helper, helped], function(err, res)  
            {
                if (err) throw err;
                console.log("new user inserted");
             });
        }
    })
    });

    app.get('/chat', function(request, response){
        var room = online[0] + "_" + online[1];
        var cql = "SELECT * FROM messaging.messages WHERE room_id = ?";
        cass_client.execute(cql, [room], { prepare: true }, function(error, result){
            if(error) throw error;
            response.render(path.join(__dirname + '/chat.ejs'), {room: room});
        });
    });

    app.get('/chat.json', function(request, response){
        var room = online[0] + "_" + online[1];
        var cql = "SELECT message_text, sender, toTimeStamp(message_id) as id FROM messaging.messages WHERE room_id = ? ORDER BY message_id ASC";
        cass_client.execute(cql, [room], { prepare: true }, function(error, result){
            if(error) throw error;
            response.json(JSON.stringify(result));
        })
    });

    app.post('/messaging', function(request, response){
        var message_text = request.body.txt;
        var sender = request.session.username;

        var room = request.body.room;
        var cql = "INSERT INTO messaging.messages(room_id, message_id, sender, message_text) VALUES (?, now(), ?, ?) USING TTL 3600";
        cass_client.execute(cql, [room, sender, message_text], { prepare: true }, function (error) {
            if (error) throw error;
          });
        response.redirect('/chat');
    });

 

var server = app.listen(3000);
//app.listen(3000);

socket = io.listen(server);

/* socket.on('connection', function(socket){
  console.log('Socket is ready');
}); */

socket.on('connect', () => {
    // either with send()
    socket.send('Hello!');})

