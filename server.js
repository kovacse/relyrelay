var mysql = require('mysql');
var express = require('express');
var session = require('express-session');
var bodyParser = require('body-parser');
var path = require('path');
var flash = require('express-flash');
var cassandra = require('cassandra-driver');
var http = require('http').Server(app);
var io = require('socket.io')(http);
var neo4j = require('neo4j-driver');

//set up db connection for mysql (user db)
var db_connection = mysql.createConnection({
    host: '34.105.143.57',
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

//setting up neo4j connection
//need to be the BOLT port connected
var neo4j_connection = neo4j.driver(
    'neo4j://35.234.144.155:7687',
    neo4j.auth.basic('neo4j', 'password')
)




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

app.get('/interests', function(request, response){
    response.render(path.join(__dirname + '/interests.ejs'));
});

app.post('/interests', function(request, response){
    //if user has interests, delete all of them so it won`t cause confusion
    var neo4j_session = neo4j_connection.session();
    var cyp = 'MATCH (n { username: $username })-[r:INTERESTED_IN]->() DELETE r';
    var params = {username: request.session.username};
    
    neo4j_session.run(cyp, params).then((result) => {
        neo4j_session.close();
    }) 
    
    //get interests set by user and make connections in db

    if (request.body.interests){
        console.log(request.body.interests, request.body.interests.length)
         //this to avoid the creation of an array of letters when only one interest is given
        if(typeof(request.body.interests) != 'string'){
            var interests = Array.from(request.body.interests)
            console.log(">1")
        }
        else{
            console.log("string")
            var interests = []
            interests.push(request.body.interests);
        }    
        var neo4j_conns = []
        var neo4j_sessions = []
        
        for(var i = 0; i < interests.length; i += 1){
            neo4j_conns[i] = neo4j.driver('neo4j://35.234.144.155:7687',neo4j.auth.basic('neo4j', 'password'))
            neo4j_sessions[i] = neo4j_conns[i].session()
            var cyp2 = 'MATCH (a:User),(b:Interest) WHERE a.username = $username AND b.subject = $subject MERGE (a)-[r:INTERESTED_IN]->(b)';
            var params2 = {username: request.session.username, subject: interests[i]};
            try{
                neo4j_sessions[i].run(cyp2, params2).then((result) => {
                    neo4j_session.close();
                }) 
            }
            catch(error){
                console.log(error)
            }
            finally{
                console.log(i)
            }  
            
        }
        response.redirect('/home');
        }
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
                    //change status in neo4j
                    var neo4j_session = neo4j_connection.session();
                    var cyp = 'MERGE (n: User{username: $username}) SET n.online = "true"';
                    var params = {username: username};
                    neo4j_session.run(cyp, params);

                    response.redirect('/home');
                }
            else
                {
                    response.send('Username and/or password is incorrect');
                }   
        });
});

app.get('/logout', function(request, response){
    request.session.loggedin = false;
    username = request.session.username;
    //change staus in neo4j
    var neo4j_session = neo4j_connection.session();
    var cyp = 'MERGE (n: User{username: $username}) SET n.online = "false"';
    var params = {username: username};
    neo4j_session.run(cyp, params).then((result) => {
        neo4j_session.close();
    });
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

    //set user type for neo4j db
    var chelp = "unknown";
    if (helper == 1 && helped == 1){
        chelp = "both";
    }
    else if(helper == 1){
        chelp = "helper";
    }
    else if(helped == 1){
        chelp = "helped";
    }

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

             //inserting user data into neo4j, too
            var neo4j_session = neo4j_connection.session();
            var cyp = 'CREATE (n: User{username: $username, type: $type, online: $online})';
            var params = {username: username, type: chelp, online: "false"};
            
            neo4j_session.run(cyp, params);
        }
    })
    response.redirect("/login")
    });



    //function to user matching
    
    app.get('/createRoom', function(request, response){
        console.log("createroom")
        var username = request.session.username;
        socket.on('generated room', (data) => {
			console.log(data.room, data.to, data.from);
        
            if(data.from == request.session.username){
            request.session.room = data.room
            console.log("room found:", request.session.room)
            }
        });
        
        function makeRoom(username, room_id, username2){
            console.log(username, room_id, username2)
            var cql = "INSERT INTO messaging.rooms(username, room_id, username2) VALUES (?, ?, ?) USING TTL 86400";
            cass_client.execute(cql, [username, room_id, username2], { prepare: true }, function (error) {
                if (error) throw error;
                console.log("room created");
          });

          cass_client.execute(cql, [username2, room_id, username], { prepare: true }, function (error) {
            if (error) throw error;
            console.log("room created");
      });
        }
        
        var neo4j_session = neo4j_connection.session();
        var cyp1 = 'MATCH (a:User{username:$username}) WITH a.type as Type RETURN Type'
        var param = {username:username}
        
        neo4j_session.run(cyp1, param)
        .then(result =>{
            result.records.forEach(record =>{
            var u1_type = record.get('Type')

            //check for user type
            if(u1_type == "both"){
                console.log("both")
                let neo4j_session2 = neo4j_connection.session();
                var cyp = 'MATCH (a:User{username:$username})-[:INTERESTED_IN]->(b:Interest), (c:User{online:"true"})-[:INTERESTED_IN]->(b) WITH b.subject AS Themes, c.username as Users RETURN Themes, Users';
                var params = {username: username};
                neo4j_session2.run(cyp, params)
                .then(results => {
                    var ls = []
                        results.records.forEach(record2 =>{
                            ls.push(record2.get("Users"))    
                    }); 

                    if (ls[0] == undefined)
                    {
                        console.log("redirect")
                        response.send('No chat partners found. It looks like there are not enough people online - please try again soon!');
                    }

                    //countOccurences one-liner is from https://www.codegrepper.com/code-examples/delphi/javascript+count+number+of+occurrences+in+array
                    const countOccurrences = arr => arr.reduce((prev, curr) => (prev[curr] = ++prev[curr] || 1, prev), {});
                    
                    //sort results and return the one with the most common appearance
                    var commons = countOccurrences(ls)
                    var s = Object.entries(commons).sort((a,b) => b[1]-a[1])
                    var choosen = s[0][0]
                    let room = username + "_" + choosen
                    makeRoom(username, room, choosen);
                    socket.emit('generated room', {'room': request.session.room, 'to': choosen, "from": username});

                    //here comes the room generation code

            
            }).catch(error =>{
                console.log(error)
            })
            }
            else if(u1_type =="helped"){
                console.log("helped")
                let neo4j_session2 = neo4j_connection.session();
                var cyp = 'MATCH (a:User{username:$username})-[:INTERESTED_IN]->(b:Interest), (c:User{online:"true", type:"helper"})-[:INTERESTED_IN]->(b) WITH b.subject AS Themes, c.username as Users RETURN Themes, Users UNION MATCH (a:User{username:$username})-[:INTERESTED_IN]->(b:Interest), (c:User{online:"true", type:"both"})-[:INTERESTED_IN]->(b) WITH b.subject AS Themes, c.username as Users RETURN Themes, Users';
                var params = {username: username};
                neo4j_session2.run(cyp, params)
                .then(results => {
                    var ls = []
                        results.records.forEach(record2 =>{
                            ls.push(record2.get("Users"))    
                    }); 

                    if (ls[0] == undefined)
                    {
                        console.log("redirect")
                        response.send('No chat partners found. It looks like there are not enough people online - please try again soon!');
                    }

                    //countOccurences one-liner is from https://www.codegrepper.com/code-examples/delphi/javascript+count+number+of+occurrences+in+array
                    const countOccurrences = arr => arr.reduce((prev, curr) => (prev[curr] = ++prev[curr] || 1, prev), {});
                    
                    //sort results and return the one with the most common appearance
                    var commons = countOccurrences(ls)
                    var s = Object.entries(commons).sort((a,b) => b[1]-a[1])
                    var choosen = s[0][0]
                    let room = username + "_" + choosen
                    makeRoom(username, room, choosen);
                    socket.emit('generated room', {'room': request.session.room, 'to': choosen, 'from': username});

                    //here comes the room generation code

            
            }).catch(error =>{
                console.log(error)
            })
            }

            else if(u1_type =="helper"){
                console.log("helper")
                let neo4j_session2 = neo4j_connection.session();
                var cyp = 'MATCH (a:User{username:$username})-[:INTERESTED_IN]->(b:Interest), (c:User{online:"true", type:"helped"})-[:INTERESTED_IN]->(b) WITH b.subject AS Themes, c.username as Users RETURN Themes, Users UNION MATCH (a:User{username:$username})-[:INTERESTED_IN]->(b:Interest), (c:User{online:"true", type:"both"})-[:INTERESTED_IN]->(b) WITH b.subject AS Themes, c.username as Users RETURN Themes, Users';
                var params = {username: username};
                neo4j_session2.run(cyp, params)
                .then(results => {
                    var ls = []
                        results.records.forEach(record2 =>{
                            ls.push(record2.get("Users"))    
                    }); 

                    if (ls[0] == undefined)
                    {
                        console.log("redirect")
                        response.send('No chat partners found. It looks like there are not enough people online - please try again soon!');
                        
                    }
                    //countOccurences one-liner is from https://www.codegrepper.com/code-examples/delphi/javascript+count+number+of+occurrences+in+array
                    const countOccurrences = arr => arr.reduce((prev, curr) => (prev[curr] = ++prev[curr] || 1, prev), {});
                    
                    //sort results and return the one with the most common appearance
                    var commons = countOccurrences(ls)
                    var s = Object.entries(commons).sort((a,b) => b[1]-a[1])
                    var choosen = s[0][0]
                    let room = username + "_" + choosen
                    makeRoom(username, room, choosen);
                    socket.emit('generated room', {'room': request.session.room, 'to': choosen, 'from': username});

                    //here comes the room generation code

            
            }).catch(error =>{
                console.log(error)
            })
            }

            else{
                console.log("else")
                let neo4j_session2 = neo4j_connection.session();
                var cyp = 'MATCH (a:User{username:$username})-[:INTERESTED_IN]->(b:Interest), (c:User{online:"true"})-[:INTERESTED_IN]->(b) WITH b.subject AS Themes, c.username as Users RETURN Themes, Users';
                var params = {username: username};
                neo4j_session2.run(cyp, params)
                .then(results => {
                    var ls = []
                        results.records.forEach(record2 =>{
                            ls.push(record2.get("Users"))    
                    }); 

                    if (ls[0] == undefined)
                    {
                        console.log("redirect")
                        response.send('No chat partners found. It looks like there are not enough people online - please try again soon!');
                    }
                    //countOccurences one-liner is from https://www.codegrepper.com/code-examples/delphi/javascript+count+number+of+occurrences+in+array
                    const countOccurrences = arr => arr.reduce((prev, curr) => (prev[curr] = ++prev[curr] || 1, prev), {});
                    
                    //sort results and return the one with the most common appearance
                    var commons = countOccurrences(ls)
                    var s = Object.entries(commons).sort((a,b) => b[1]-a[1])
                    var choosen = s[0][0]
                    let room = username + "_" + choosen
                    makeRoom(username, room, choosen);
                    socket.emit('generated room', {'room': request.session.room, 'to': choosen, 'from': username});
                    //here comes the room generation code
                    
            
            }).catch(error =>{
                console.log(error)
            })

            }

        })
    })
    response.redirect('/chat')
})
        
   app.post('/getRoom', function(request, response){
       var room = request.body.room;
       request.session.room = room;
       //response.redirect('/chat')
   })     

   app.get('/chat', function(request, response){
    response.render(path.join(__dirname + '/chat.ejs'))
   })


/*     app.get('/chat', function(request, response){
        socket.on('generated room', (data) => {
			console.log(data.room, data.to, data.from);
        
            if(data.from == request.session.username){
            request.session.room = data.room
            }
		});


        console.log("is this ",request.session.room)
            
            var room = request.session.room;
            var cql = "SELECT * FROM messaging.messages WHERE room_id = ?";
            cass_client.execute(cql, [room], { prepare: true }, function(error, result){
                if(error) throw error;
                response.render(path.join(__dirname + '/chat.ejs'), {room: room});
            });
        

    }); */

    app.get('/chat.json', function(request, response){
        let username = request.session.username;
        var c1 = "SELECT room_id FROM messaging.rooms WHERE username = ?;"
        cass_client.execute(c1, [username], { prepare: true }, function (error, result) {
            if (error) throw error;
            if (result.rows[0] == undefined){
                
                console.log("redir")
                return response.redirect('/createRoom')

            }
            var room = result.rows[0].room_id
            console.log(room)
            var cql = "SELECT message_text, sender, toTimeStamp(message_id) as id FROM messaging.messages WHERE room_id = ? ORDER BY message_id ASC";
            cass_client.execute(cql, [room], { prepare: true }, function(error, result){
                if(error) throw error;
                response.json(JSON.stringify(result));
            })


          });
        
          
    });

    app.post('/messaging', function(request, response){
        var message_text = request.body.txt;
        var sender = request.session.username;
        let username = request.session.username;
        var c1 = "SELECT username, room_id, username2 FROM messaging.rooms WHERE username = ?;"
        cass_client.execute(c1, [username], { prepare: true }, function (error, result) {
            if (error) throw error;
            var room = result.rows[0].room_id
            var cql = "INSERT INTO messaging.messages(room_id, message_id, sender, message_text) VALUES (?, now(), ?, ?) USING TTL 3600";
            cass_client.execute(cql, [room, sender, message_text], { prepare: true }, function (error) {
                if (error) throw error;
                socket.emit('added to chat', {'sender': sender});
                });
            response.redirect('/chat');
            })
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

