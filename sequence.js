var mongoose = require('mongoose');
var Semaphore = require('node-semaphore');

var Schema = mongoose.Schema;

var CounterSchema = new Schema({
	_id : {type : String, required : true},
	sequence : {type : Number, required : true}
});

var Counter = mongoose.model('Counter',CounterSchema);
//a semaphore lock with one slot used to prevent race conditions
var pool = Semaphore(1);

exports.getNext = function(conn,collection,callback){

	var query = {_id : collection};
	var update = {$inc : {sequence : 1}};
	var options = {upsert : true};

	var processMatchesLock = function(){
		//check if the counter exists by counting matches
		Counter.count(query,processCount);
	}

	var processCount = function(err,count){
		if(err){
			//release the semaphore used in checking if the counter exists
			pool.release();
			callback(err);
		} else if (count > 0){
			//release the semaphore used in checking if the counter exists
			pool.release();
			//acquire the semaphore to prevent race conditions until a number is issued from the counter
			pool.acquire(processFindAndUpdateLock);
		} else {
			//if the counter does not exist yet, create it with an initial sequence value of 1
			var ctr = new Counter({
				_id : collection,
				sequence : 1
			})
			//save the counter to the counters collection in the database
			ctr.save(processSave);
		}
	}

	var processSave = function(err,doc){
		//release the semaphore used in checking if the counter exists
		pool.release();
		if(err){
			callback(err);
		} else {
			//acquire the semaphore to prevent race conditions until a number is issued from the counter
			pool.acquire(processFindAndUpdateLock);
		}
	}

	var processFindAndUpdateLock = function(){
		//if the counter exists, update it
		Counter.findOneAndUpdate(query,update,options,returnCounter);
	}

	var returnCounter = function(err,counter){
		pool.release();
		if(err){
			callback(err);
		} else {
			callback(collection,counter.sequence);
		}
	}

	//acquire the semaphore lock to allow only one thread to enter the condition where the counter is going to be created
	pool.acquire(processMatchesLock);
}

/*
	can be called as outputCounter(err) or outputCounter(collection,counter)
*/
var outputCounter = function(err,collection,counter){
	var args = [];
	var argCount = arguments.length;
	
	//get all the arguments of the function and save to args array
	for(var i=0;i<argCount;i+=1){
		args.push(arguments[i]);
	}

	if(args[0] instanceof Error){ //outputCounter(err) call
		console.log('Something went wrong...\n'+err);
		return;
	} else { //outputCounter(collection,counter) call
		collection = args[0];
		counter = args[1];
		//console.log('Current '+ collection +' count : ' + counter);
	}
}

//exports.getNext('food',outputCounter);
//exports.getNext('nutrition_facts',outputCounter);