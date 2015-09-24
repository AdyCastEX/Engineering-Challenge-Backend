var request = require('request');
var cheerio = require('cheerio');
var mongoose = require('mongoose');
var sequence = require('./sequence.js');  

//connect to the database on port 27017 of localhost and store the connection
var conn = mongoose.connect('mongodb://localhost:27017/myfitnesspal'); 
var Schema = mongoose.Schema;

var nutritionFactsSchema = new Schema({
	_id : {type : Number, required : true},
	calories : {type : String, required : true},
	total_fat : {type : String, required : true},
	saturated : {type : String, required : true},
	polyunsaturated : {type : String, required : true},
	monounsaturated : {type : String, required : true},
	trans : {type : String, required : true},
	cholesterol : {type : String, required : true},
	sodium : {type : String, required : true},
	potassium : {type : String, required : true},
	total_carbs : {type : String, required : true},
	dietary_fiber : {type : String, required : true},
	sugars : {type : String, required : true},
	protein : {type : String, required : true},
	vitamin_a : {type : String, required : true},
	vitamin_c : {type : String, required : true},
	calcium : {type : String, required : true},
	iron : {type : String, required : true}
});

var foodSchema = new Schema({
	_id : {type : Number, required : true},
	food_name : {type : String, required : true},
	food_company : {type:String,required:false},
	nutrition_facts : [nutritionFactsSchema]
});

var Food = mongoose.model('Food',foodSchema);
var NutritionFacts = mongoose.model('NutritionFacts',nutritionFactsSchema);

/*
	Converts a string to replace spaces with underscore ('_') and make all letters lower case
	Parameters :
	str                 -- the string to convert
*/

var formatString = function(str){
	formatted = str.split(' ').join('_');
	formatted = formatted.toLowerCase();
	formatted = formatted.trim();
	return formatted;
}

var main = function(){
	var tagLinks = [];
	var tagNames = [];
	var tags;
	var baseUrl = 'http://www.myfitnesspal.com';
	var tagLinkPages = [];
	var foodLinks = [];

	var startPageOptions = {
		uri : 'http://www.myfitnesspal.com/food/calorie-chart-nutrition-facts',
		headers : {
			'User-Agent' : 'request'
		}
	};

	var processFoodTags = function(err,response,html){
		var $ = cheerio.load(html);
		//get all the tags from the 'Popular Tags' div
		tags = $('.tag_cloud a');
		//for each tag get the reference url e.g. http://www.myfitnesspal.com/tag/show/chicken
		tags.each(function(){
			var tag = $(this);
			tagLinks.push(baseUrl + tag.attr('href'));
			tagNames.push(tag.text());
		});

		processTagLinks(tagLinks,processTagLinkResults);
	}

	/* Visit each of the pages referenced by the food tags (called 'tag links') and fetch the links to their paginated results
		Parameters : 
		links                    --an array of urls containing tag links
		callback                 --the callback function used to indicate that all tag links have been processed
	*/
	var processTagLinks = function(links,callback){
		var numTagLinks = links.length;
		var inserts = 0;

		for(var i=0;i<numTagLinks;i+=1){
			var pageOptions = {
				uri : links[i],
				headers : {
					'User-Agent' : 'request'
				}
			};
			request(pageOptions,function(err,response,html){
				if(err){
					callback(err);
					return;
				}
				var foodPages = [];
				processTagLink(html,tagLinkPages);
				if(++inserts == numTagLinks){
					callback(tagLinkPages);
				}
			})			
		}
	}

	/*
		Parse the page referenced by a tag link as jQuery readable format then build the urls to the paginated results
		Parameters :
		html                     --the html code of the page
		tagLinkPages             --an array used to store the urls of the paginated results 
	*/
	var processTagLink = function(html,tagLinkPages){
		var $ = cheerio.load(html);

		var numTagLinkPages = parseInt($('.pagination').children().eq(-2).text());
		var pageTitle = $('#page_title').text().trim(); //e.g. "Results for Chicken"
		var tag = pageTitle.split(' ')[2].toLowerCase(); //split by whitespaces, get the word at index 2, and convert to lower case

		for(var i=1;i<=numTagLinkPages;i+=1){
			//sample link : http://myfitnesspal.com/tag/show/chicken/100
			tagLinkPages.push(baseUrl+'/tag/show/'+ tag + '/' + i);
		}

	}

	var processTagLinkResults = function(result){
		if(result instanceof Error){
			console.log('Something went wrong\n'+result);
		} else {
			console.log('Done processing tag links...\nNow Processing each tag link per page...');
			processTagLinkPages(result,foodLinks,processTagLinkPageResults);
		}
	}

	/* Visit the pages of the paginated results of each tag link (tag link pages)
		Parameters:
		tagLinkPages             --an array of urls referencing paginated links associated with a tag
		foodLinks                --an array for storing the urls to each food item
		callback                 --a callback function which is called when all pages have been visited
	*/
	var processTagLinkPages = function(tagLinkPages,foodLinks,callback){
		var numTagLinkPages = tagLinkPages.length;
		var tagLinkPagesProcessed = 0;

		var lowerBound = 0;
		var step = 300;
		var upperBound = lowerBound + step;

		if(upperBound > numTagLinkPages){
			upperBound = numTagLinkPages;
		}

		/*send requests to tag pages per batch
			Parameters :
			lowerBound 						--the first index of the batch
			upperBound                    	--the last index of the batch
			step                            --the number of tag pages in the batch
			processNextBatch                --the callback function to start the next batch
		*/
		var processTagPageBatch = function(lowerBound,upperBound,step,processNextBatch){
			var maxSteps = upperBound-lowerBound;
			var numSteps = 0;

			var processRequest = function(err,response,html){
				if(err){
					callback(err);
					return;
				}
				processTagLinkPage(html,foodLinks);
				tagLinkPagesProcessed += 1;
				//check if all tag link pages in the batch have been processed
				if(++numSteps == maxSteps){
					processNextBatch(upperBound,step);
				}
			}

			for(var i=lowerBound;i<upperBound;i+=1){
				var pageOptions = {
					uri : tagLinkPages[i],
					headers : {
						'User-Agent' : 'request'
					}
				};
				request(pageOptions,processRequest);
			}
		}

		/*
			Set the upper and lower bounds for the next batch
			Parameters :
			lastUpperBound               --the last index of the previous batch
			step                         --the number of tag pages for the next batch
		*/
		var processNextBatch = function(lastUpperBound,step){
			var lowerBound = lastUpperBound;
			var upperBound = lowerBound + step; //by default, the upper bound is n steps away from the lower bound

			/* if the upper bound exceeds the total number of tag links, move it down to the the total number of tag links
				sample case:
					step = 100
					total tag links = 531
				-> last batch will only have 31 tag links instead of 100  */
			if(upperBound > numTagLinkPages){
				upperBound = numTagLinkPages;
			}
			console.log(tagLinkPagesProcessed + ' / ' + numTagLinkPages + ' tag link pages processed');
			if(tagLinkPagesProcessed == numTagLinkPages){
				//use the callback defined in processTagLinkPages() to signal that all tag link pages have been processed
				callback(foodLinks);
			} else {
				//call the next batch
				processTagPageBatch(lowerBound,upperBound,step,processNextBatch);
			}
		}

		processTagPageBatch(lowerBound,upperBound,step,processNextBatch);

	}

	/* get all the urls to food pages from each tag link page
		Parameters :
		html            --the html code of the page
		foodLinks       --an array used to store the urls of food links
	*/

	var processTagLinkPage = function(html,foodLinks){
		var $ = cheerio.load(html);
		var descriptions = $('div.food_info .food_description');

		descriptions.each(function(){
			var descData = $(this);
			var foodLink = descData.children().eq(0).attr('href');
			foodLinks.push(baseUrl + foodLink);
		});
	}

	var processTagLinkPageResults = function(result){
		if(result instanceof Error){
			console.log('Something went wrong\n'+result);
		} else {
			console.log('Done processing tag link pages...\nNow processing each food page...')
			processFoodLinks(result,processFoodLinksResults);
		}
	}

	/* Get data from individual food pages and insert them to the database
		Parameters:
		foodLinks                        -- an array of urls to food pages
		callback                         -- a callback function called when all food pages have been processed 
	*/

	var processFoodLinks = function(foodLinks,callback){
		var numFoodLinks = foodLinks.length;
		var numFoodLinksProcessed = 0;

		var lowerBound = 0;
		var step = 300;
		var upperBound = lowerBound + step;

		if(upperBound > numFoodLinks){
			upperBound = numFoodLinks;
		}

		var processFoodLinkBatch = function(lowerBound,upperBound,step,processNextBatch){
			var maxSteps = upperBound-lowerBound;
			var numSteps = 0;

			var moveToNextBatch = function(result){
				if(result instanceof Error){
					console.log('Something went wrong\n'+result);
				} else {
					numFoodLinksProcessed += 1;
					if(++numSteps == maxSteps){
						processNextBatch(upperBound,step);
					}
				}
			}

			var processRequest = function(err,response,html){
				if(err){
					callback(err);
					return;
				}
				processFoodLink(html,moveToNextBatch);
			}


			for(var i=lowerBound;i<upperBound;i+=1){
				var pageOptions = {
					uri : foodLinks[i],
					headers : {
						'User-Agent' : 'request'
					}
				};
				request(pageOptions,processRequest);
			}
		}

		var processNextBatch = function(lastUpperBound,step){
			var lowerBound = lastUpperBound;
			var upperBound = lowerBound + step;
			if(upperBound > numFoodLinks){
				upperBound = numFoodLinks;
			}
			console.log(numFoodLinksProcessed + ' / ' + numFoodLinks + ' foods inserted');
			if(numFoodLinksProcessed == numFoodLinks){
				callback();
			} else {
				processFoodLinkBatch(lowerBound,upperBound,step,processNextBatch);
			}
		}

		processFoodLinkBatch(lowerBound,upperBound,step,processNextBatch);
	}

	/* Visit a food link (page) to get the data for the food item
		Parameters:
		html                            -- the html code for the page in string form
		callback                        -- a callback function used when the food item has been inserted to the database
	*/

	var processFoodLink = function(html,callback){
		var $ = cheerio.load(html);
		var keys = [];
		var values = [];
		var nutritionFacts;
		var food;

		//the food description on the col-1 div stores the name of the food
		var foodName = $('.col-1 .food-description').text().trim();
		var foodCompany;
		//the secondary title on the col-1 div is formatted as 'More from <company>'
		var secondaryTitle = $('#other-info .col-1 .secondary-title').text().trim();
		//everything that follows the word 'from' is considered as the company
		foodCompany = secondaryTitle.split('More from ');
		//case when the foodCompany is either empty or does not contain the words 'More from '
		if(foodCompany.length > 1){
			foodCompany = foodCompany[1].trim();
		}	
		
		//gets the tr elements of the table with id nutrition-facts
		nutritionFactsRows = $('#nutrition-facts').children().eq(1).children();
		
		//all the .col-2 <tr>'s contain nutrient values (e.g. 100g) 
		var nutrientValues = nutritionFactsRows.children('.col-2');
	    nutrientValues.each(function(){
			values.push($(this).text());
		});

	    //all the .col-1 <tr>'s contain the name of the nutrient (e.g. Protein)
		var nutrients = nutritionFactsRows.children('.col-1');
		nutrients.each(function(){
			keys.push($(this).text());	
		});
		
		var processCounter = function(err,counter){
			var args = arguments;
			var argCount = arguments.length;

			if(args[0] instanceof Error){
				err = args[0];
				callback(err);
			} else {
				var numKeyValues = keys.length;
				nutritionFacts = new NutritionFacts();
				//build nutrition facts based on the key-value pairs scraped from the food page
				for(var i=0;i<numKeyValues;i+=1){
					if(keys[i].length > 1){
						var key = formatString(keys[i]);
						nutritionFacts[key] = values[i];
					}
				}
				nutritionFacts['_id'] = counter;
				food = new Food({
					_id : counter,
					food_name : foodName,
					food_company : foodCompany,
					nutrition_facts : nutritionFacts
				});
				food.save(onSave);
			}
		}

		var onSave = function(err,doc){
			if(err){
				callback(err);
			} else {
				callback(doc);
			}
		}

		sequence.getNext(conn,'food',processCounter);
	}

	var processFoodLinksResults = function(result){
		if(result instanceof Error){
			console.log('Something went wrong\n'+result);
		} else {
			console.log('Finished! Press Ctrl+C to exit');
		}
	}

	console.log('Food Scraper starting...');
	request(startPageOptions,processFoodTags);
}

main();

