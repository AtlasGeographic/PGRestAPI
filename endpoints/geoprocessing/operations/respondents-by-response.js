var flow = require('flow');
var pg = require('pg');
var validOptions = require('./valid-options.json');
var common = require("../../../common");

var operation = {};


/* METADATA */

operation.name = "RespondentsByResponse";
operation.description = "Return a set of respondent ids that meet question-response criteria.";
operation.inputs = {};


operation.inputs["surveyId"] = { value: "", required: true, help: "" };
operation.inputs["questionId"] = { value: "", required: true, help: "" };
operation.inputs["questionType"] = { value: "", required: true, help: "" };
operation.inputs["responseCriteria"] = { value: "", required: true, help: "" };

operation.execute = flow.define(
    function(args, callback) {


        this.args = args;
        this.callback = callback;

        var surveyId = operation.inputs["surveyId"].value = args.surveyId;
        var questionId = operation.inputs["questionId"].value = args.questionId;
        var questionType = operation.inputs["questionType"].value = args.questionType;
        var responseCriteriaJSON = operation.inputs["responseCriteria"].value = args.responseCriteria;
        var responseCriteria;
        var responseClause;

        try {

            responseCriteria = JSON.parse(responseCriteriaJSON);

        } catch (e) {
            return callback({text: "Response Criteria is not valid JSON."});
        }




        if(/^\s*(\+|-)?\d+\s*$/.test(surveyId) === false){
            return callback({text: "Survey ID is not an integer."});
        };

        if(/^\s*(\+|-)?\d+\s*$/.test(questionId) === false){
            return callback({text: "Question ID is not an integer."});
        };

        if(['integer', 'decimal', 'select one', 'select all that apply'].indexOf(questionType) === -1) {
            return callback({text: "Question type is not valid."});
        }

        if(questionType === 'integer' || questionType === 'decimal') {

            if(!responseCriteria.hasOwnProperty('min') || !responseCriteria.hasOwnProperty('max')){

                return callback({text: "Response criteria is not valid for question type '" + questionType + "'."});
            }
        } else {

            if(!responseCriteria.hasOwnProperty('values')){

                return callback({text: "Response criteria is not valid for question type '" + questionType + "'."});

            } else if (!responseCriteria.values instanceof Array){

                return callback({text: "Response criteria is not valid for question type '" + questionType + "'."});

            } else {

                var invalid = false;

                responseCriteria.values.some(function(value){


                    if(validOptions.indexOf(value) === -1) {

                        invalid = true;
                        return false;

                    }

                });

                if(invalid) {

                    return callback({text: "Response criteria is not valid for question type '" + questionType + "'."});

                }
            }
        }

        // Create response clause
        if(questionType === 'integer' || questionType === 'decimal') {

            responseClause = "numeric >= " + responseCriteria.min + " AND numeric <= " + responseCriteria.max;

        } else {

            var clauseArr = responseCriteria.values.map(function(value){

                return "text SIMILAR TO '%(" + value + ")%'";

            });

            responseClause = clauseArr.join(' AND ');

        }

        //Step 1

        //See if inputs are set. Incoming arguments should contain the same properties as the input parameters.
        if (operation.isInputValid(operation.inputs) === true) {


            //The query to be executed
            var query = "SELECT array_to_json(array_agg(respondent_id)) as respondents FROM response WHERE "
                + "(survey_id = {{surveyId}} AND question_id = {{questionId}}) AND {{responseClause}}";

            var sql = { text: query.replace(/{{surveyId}}/g, surveyId)
                .replace("{{questionId}}", questionId)
                .replace("{{responseClause}}", responseClause), values: []};

            common.executePgQuery(sql, this);//Flow to next function when done.

        }
        else {
            //Invalid arguments
            //return message
            callback({text: "Missing required arguments."});
        }
    },
    function(err, results) {
        //Step 2 - get the results and pass back to calling function
        this.callback(err, results);
    }
);

//Make sure arguments are tight before executing
operation.isInputValid = function(input) {
    //Check inputs
    if(input){
        for (var key in input) {
            if (input.hasOwnProperty(key)) {
                if (input[key].required && (!input[key].value || input[key].value.length == 0)) {
                    //Required but not present.
                    return false;
                }
            }
        }
    }

    return true;
};

module.exports = operation;