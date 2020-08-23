var mysql = require('mysql');
var express = require('express');
var session = require('express-session');
var bodyParser = require('body-parser');
var path = require('path');
var flash = require('express-flash');

//set up db connection
var db_connection = mysql.createConnection({
    host: '35.189.68.169',
    user: 'root',
    password: 'password',
    database: 'Accounts'
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



//show login.html to user
app.get('/login', function(request, response){
    response.sendFile(path.join(__dirname + '/server.html'));
});

app.post('/login', function(request, response){
    var username = request.body.username;
    var password = request.body.password;

    console.log(username);

   
    var sql = "SELECT * FROM `Users` WHERE `username`='"+username+"' and password = '"+password+"'";
    db_connection.query(sql, function(error, results, fields)
        {
            if (error) throw error;
            if (results.length > 0)
                {
                    request.session.loggedin = true;
                    request.session.username = username;
                    response.redirect('/home');
                }
            else
                {
                    response.send('Username and/or password is incorrect');
                }   
        });
      
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

app.listen(3000);
