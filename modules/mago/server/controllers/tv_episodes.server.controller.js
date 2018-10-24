'use strict';

/**
 * Module dependencies.
 */
var path = require('path'),
    errorHandler = require(path.resolve('./modules/core/server/controllers/errors.server.controller')),
    logHandler = require(path.resolve('./modules/mago/server/controllers/logs.server.controller')),
    db = require(path.resolve('./config/lib/sequelize')).models,
    sequelize_t = require(path.resolve('./config/lib/sequelize')),
    DBModel = db.vod,
    refresh = require(path.resolve('./modules/mago/server/controllers/common.controller.js')),
    request = require("request"),
    fs = require('fs');

function link_vod_with_genres(vod_id,array_category_ids, db_model) {
    var transactions_array = [];
    //todo: references must be updated to non-available, not deleted
    return db_model.update(
        {
            is_available: false
        },
        {
            where: {
                vod_id: vod_id,
                category_id: {$notIn: array_category_ids}
            }
        }
    ).then(function (result) {
        return sequelize_t.sequelize.transaction(function (t) {
            for (var i = 0; i < array_category_ids.length; i++) {
                transactions_array.push(
                    db_model.upsert({
                        vod_id: vod_id,
                        category_id: array_category_ids[i],
                        is_available: true
                    }, {transaction: t}).catch(function(error){
                        console.log(error)
                    })
                )
            }
            return Promise.all(transactions_array, {transaction: t}); //execute transaction
        }).then(function (result) {
            return {status: true, message:'transaction executed correctly'};
        }).catch(function (err) {
            return {status: false, message:'error executing transaction'};
        })
    }).catch(function (err) {
        return {status: false, message:'error deleting existing packages'};
    })
}

function link_vod_with_packages(item_id, data_array, model_instance) {
    var transactions_array = [];
    var destroy_where = (data_array.length > 0) ? {
        vod_id: item_id,
        package_id: {$notIn: data_array}
    } : {vod_id: item_id};

    return model_instance.destroy({
        where: destroy_where
    }).then(function (result) {
        return sequelize_t.sequelize.transaction(function (t) {
            for (var i = 0; i < data_array.length; i++) {
                transactions_array.push(
                    model_instance.upsert({
                        vod_id: item_id,
                        package_id: data_array[i]
                    }, {transaction: t})
                )
            }
            return Promise.all(transactions_array, {transaction: t}); //execute transaction
        }).then(function (result) {
            return {status: true, message:'transaction executed correctly'};
        }).catch(function (err) {
            return {status: false, message:'error executing transaction'};
        })
    }).catch(function (err) {
        return {status: false, message:'error deleteting existing packages'};
    })
}

/**
 * Create
 */
exports.create = function(req, res) {

    var array_vod_vod_categories = req.body.vod_vod_categories || [];
    delete req.body.vod_vod_categories;

    var array_package_vod = req.body.package_vods || [];
    delete req.body.package_vods;

    DBModel.findOne({
        attributes: ['id'], where: {vod_parent_id: req.body.tv_show_id, season_number: Number(req.body.season_number)}
    }).then(function(season_id) {
        if(season_id && season_id.id){
            req.body.vod_parent_id = season_id.id;
            if(!req.body.vod_type) req.body.vod_type = 'tv_episode';
            DBModel.create(req.body).then(function(result) {
                if (!result) {
                    return res.status(400).send({message: 'fail create data'});
                } else {
                    logHandler.add_log(req.token.uid, req.ip.replace('::ffff:', ''), 'created', JSON.stringify(req.body));
                    return link_vod_with_genres(result.id,array_vod_vod_categories, db.vod_vod_categories).then(function(t_result) {
                        if (t_result.status) {
                            return link_vod_with_packages(result.id, array_package_vod, db.package_vod).then(function(t_result) {
                                if (t_result.status) {
                                    return res.jsonp(result);
                                }
                                else {
                                    return res.send(t_result);
                                }
                            })
                        }
                        else {
                            return res.send(t_result);
                        }
                    })
                }
            }).catch(function(err) {
                return res.status(400).send({
                    message: errorHandler.getErrorMessage(err)
                });
            });
            return null;
        }
        else{
            return res.status(400).send({message: 'Unable to find this season for the tv show'});
        }
    }).catch(function(err) {
        return res.status(400).send({
            message: errorHandler.getErrorMessage(err)
        });
    });


};
/**
 * Show current
 */
exports.read = function(req, res) {
    res.json(req.vod);
};

/**
 * Update
 */
exports.update = function(req, res) {

    var updateData = req.vod;
    if(updateData.icon_url != req.body.icon_url) {
        var deletefile = path.resolve('./public'+updateData.icon_url);
    }
    if(updateData.image_url != req.body.image_url) {
        var deleteimage = path.resolve('./public'+updateData.image_url);
    }

    var array_vod_vod_categories = req.body.vod_vod_categories || [];
    delete req.body.vod_vod_categories;

    var array_package_vod = req.body.package_vods || [];
    delete req.body.package_vods;

    DBModel.findOne({
        attributes: ['id'], where: {vod_parent_id: req.body.season_filter.tv_show_filter.tv_show_id, season_number: Number(req.body.season_number)}
    }).then(function(season_id) {
        if(season_id && season_id.id){
            req.body.vod_parent_id = season_id.id;
            if(!req.body.vod_type) req.body.vod_type = 'tv_episode';
            updateData.updateAttributes(req.body).then(function(result) {
                if(deletefile) {
                    fs.unlink(deletefile, function (err) {
                        //todo: return some warning
                    });
                }
                logHandler.add_log(req.token.uid, req.ip.replace('::ffff:', ''), 'created', JSON.stringify(req.body));
                if(deleteimage) {
                    fs.unlink(deleteimage, function (err) {
                        //todo: return some warning
                    });
                }
                return link_vod_with_genres(req.body.id,array_vod_vod_categories, db.vod_vod_categories).then(function(t_result) {
                    if (t_result.status) {
                        return link_vod_with_packages(req.body.id, array_package_vod, db.package_vod).then(function(t_result) {
                            if (t_result.status) {
                                return res.jsonp(result);
                            }
                            else {
                                return res.send(t_result);
                            }
                        })
                    }
                    else {
                        return res.send(t_result);
                    }
                })
            }).catch(function(err) {
                return res.status(400).send({
                    message: errorHandler.getErrorMessage(err)
                });
            });
        }
        else{
            return res.status(400).send({message: 'Unable to find this season for the tv show'});
        }
    }).catch(function(err) {
        return res.status(400).send({
            message: errorHandler.getErrorMessage(err)
        });
    });

};

/**
 * Delete
 */
exports.delete = function(req, res) {
    //delete single vod item and it's dependencies, as long as the item doesn't belong to a package
    db.package_vod.findAll({
        where: {vod_id: req.vod.id}
    }).then(function (delete_vod) {
        if (delete_vod && delete_vod.length > 0) {
            return res.status(400).send({message: 'This item belongs to at least one package. Please remove it from the packages and try again'});
        }
        else {
            return sequelize_t.sequelize.transaction(function (t) {
                return db.vod_vod_categories.destroy({where: {vod_id: req.vod.id}}, {transaction: t}).then(function (removed_genres) {
                    return db.vod_stream.destroy({where: {vod_id: req.vod.id}}, {transaction: t}).then(function (removed_genres) {
                        return db.vod_subtitles.destroy({where: {vod_id: req.vod.id}}, {transaction: t}).then(function (removed_subtitles) {
                            return db.vod.destroy({where: {id: req.vod.id}}, {transaction: t});
                        });
                    });
                });
            }).then(function (result) {
                return res.json(result);
            }).catch(function (err) {
                return res.status(400).send({message: 'Deleting this vod item failed : ' + error});
            });
        }
    }).catch(function (error) {
        return res.status(400).send({message: 'Searching for this vod item failed : ' + error});
    });

};

exports.list = function(req, res) {
    var qwhere = {},
        final_where = {},
        query = req.query;

    var package_where = (query.not_id) ? {id: {$notIn: [query.not_id]}} : {id: {$gt: 0}};

    if(query.q) {
        qwhere.$or = {};
        qwhere.$or.title = {};
        qwhere.$or.title.$like = '%'+query.q+'%';
        qwhere.$or.description = {};
        qwhere.$or.description.$like = '%'+query.q+'%';
        qwhere.$or.director = {};
        qwhere.$or.director.$like = '%'+query.q+'%';
    }

    if(query.title) qwhere.title = {like: '%'+query.title+'%'};

    //filter films added in the following time interval
    if(query.added_before && query.added_after) qwhere.createdAt = {lt: query.added_before, gt: query.added_after};
    else if(query.added_before) qwhere.createdAt = {lt: query.added_before};
    else if(query.added_after) qwhere.createdAt = {gt: query.added_after};
    //filter films updated in the following time interval
    if(query.updated_before && query.updated_after) qwhere.createdAt = {lt: query.updated_before, gt: query.updated_after};
    else if(query.updated_before) qwhere.createdAt = {lt: query.updated_before};
    else if(query.updated_after) qwhere.createdAt = {gt: query.updated_after};
    if(query.expiration_time) qwhere.expiration_time = query.expiration_time;
    if(query.isavailable === 'true') qwhere.isavailable = true;
    else if(query.isavailable === 'false') qwhere.isavailable = false;

    //start building where
    final_where.where = qwhere;
    if(parseInt(query._end) !== -1){
        if(parseInt(query._start)) final_where.offset = parseInt(query._start);
        if(parseInt(query._end)) final_where.limit = parseInt(query._end)-parseInt(query._start);
    }
    if(query._orderBy) final_where.order = query._orderBy + ' ' + query._orderDir;

    var package_filter = (req.query.package_id) ? {
        where: {package_id: Number(req.query.package_id)},
        required: true
    } : {where: {package_id: {gt: 0}}, required: false};
    var category_filter = (req.query.category) ? {
        where: {category_id: Number(req.query.category), is_available: true},
        required: true
    } : {where: {category_id: {gt: 0}, is_available: true}, required: false};
    final_where.include = [
        {
            model: db.vod_vod_categories,
            attributes: ['category_id'],
            where: category_filter.where,
            required: category_filter.required
        },
        {
            model: db.package_vod,
            attributes: ['package_id'],
            required: package_filter.required,
            where: package_filter.where
        }
    ];

    if(!query.season_number) query.season_number = {$gt: 0};
    if(!query.tv_show_title) query.tv_show_title = '';
    var tv_show_filter = {model: db.vod, as: 'season_filter', attributes: [['id', 'tv_season_id']], where: {season_number: query.season_number},
        include: [{model: db.vod, as: 'tv_show_filter', attributes: [['id', 'tv_show_id']], where: {title: {like: '%'+query.tv_show_title+'%'}} }]
    };
    final_where.include.push(tv_show_filter);

    final_where.where.vod_type = 'tv_episode';

    final_where.distinct = true; //avoids wrong count number when using includes
    //end build final where

    if(query.not_id){
        db.package_vod.findAll({attributes: [ 'vod_id'], where: {package_id: query.not_id}}).then(function(excluded_vod_items){
            //prepare array with id's of all vod items that belong to specified package
            var excluded_item_list = [];
            for(var i=0; i<excluded_vod_items.length; i++) excluded_item_list.push(excluded_vod_items[i].vod_id);
            if(excluded_item_list.length > 0) qwhere.id = {$notIn: excluded_item_list}; //if there are items to be excluded, add notIn filter

            DBModel.findAndCountAll(final_where).then(function(results) {
                if (!results) return res.status(404).send({message: 'No data found'});
                else {
                    res.setHeader("X-Total-Count", results.count);
                    res.json(results.rows);
                }
            }).catch(function(err) {
                res.jsonp(err);
            });
        });
    }
    else{
        DBModel.findAndCountAll(
            final_where
        ).then(function(results) {
            if (!results) {
                return res.status(404).send({
                    message: 'No data found'
                });
            } else {
                res.setHeader("X-Total-Count", results.count);
                res.json(results.rows);
            }
        }).catch(function(err) {
            res.jsonp(err);
        });
    }



};

/**
 * middleware
 */
exports.dataByID = function(req, res, next, id) {


    if ((id % 1 === 0) === false) { //check if it's integer
        return res.status(404).send({
            message: 'Data is invalid'
        });
    }

    DBModel.find({
        where: {
            id: id
        },
        include: [
            {model: db.vod_vod_categories, where: {is_available: true}, required: false}, //outer join, to display also movies that don't belong to any category
            {model: db.package_vod, required: false},{model: db.vod_subtitles, attributes: ['id', 'title', ['id', 'value'], ['title', 'label']]},{model: db.vod_stream},
            {model: db.vod, as: 'season_filter', attributes: [['id', 'tv_season_id']],
                include: [{model: db.vod, as: 'tv_show_filter', attributes: [['id', 'tv_show_id']] }]
            }
        ]
    }).then(function(result) {
        if (!result) {
            return res.status(404).send({
                message: 'No data with that identifier has been found'
            });
        } else {

            req.vod = result;
            next();
            return null;
        }
    }).catch(function(err) {
        return next(err);
    });

};

/**
 * @api {post} /api/update_film/ update film
 * @apiVersion 0.2.0
 * @apiName UpdateFilm3rdParty
 * @apiGroup Backoffice
 * @apiHeader {String} authorization Token string acquired from login api.
 * @apiDescription Gets movie information from a third party and updates movie
 * @apiSuccessExample Success-Response:
 *     {
 *       "title": "Pan's Labyrinth",
 *       "imdb_id": "tt0457430",
 *       "description": "In the falangist Spain of 1944, ...",
 *       "year": "2006",
 *       "rate": 8,
 *       "duration": "118",
 *       "director": "Guillermo del Toro",
 *       "starring": "Ivana Baquero, Sergi López, Maribel Verdú, Doug Jones"
 *      }
 * @apiErrorExample Error-Response:
 *     {
 *        "message": "error message"
 *     }
 *     Error value set:
 *     An error occurred while updating this movie // Unexpected error occurred when the movie was being updated with teh new data
 *     Could not find this movie // the search params did not return any movie
 *     An error occurred while searching for this movie // Unexpected error occurred while searching for the movie in our database
 *     An error occurred while trying to get this movie's data // Unexpected error occurred while getting the movie's data from the 3rd party
 *     Unable to parse response // The response from the 3rd party service was of invalid format
 *     Unable to find the movie specified by your keywords // The 3rd party service could not find a match using our keywords
 *
 */
exports.update_film = function(req, res) {

    //todo: take care of case when param list is empty.
    var vod_where = {};
    if(req.body.imdb_id) vod_where.imdb_id = req.body.imdb_id;
    else if(req.body.vod_id) vod_where.id = req.body.vod_id;
    else {
        if(req.body.title) vod_where.title = req.body.title;
        if(req.body.year) vod_where.year = req.body.year;
    }

    DBModel.findOne({
        attributes: ['title', 'imdb_id'], where: vod_where
    }).then(function(vod_data){
        if(vod_data){
            var search_params = {"vod_title": vod_data.title};
            if(vod_data.imdb_id !== null) search_params.imdb_id = vod_data.imdb_id; //only use if it is not null
            omdbapi(search_params, function(error, response){
                if(error){
                    return res.status(404).send({
                        message: response
                    });
                }
                else{
                    DBModel.update(
                        response, {where: vod_where}
                    ).then(function(result){
                        res.send(response);
                    }).catch(function(error){
                        return res.status(404).send({
                            message: "An error occurred while updating this movie"
                        });
                    });
                    return null;
                }
            });
        }
        else return res.status(404).send({
            message: "Could not find this movie"
        });
    }).catch(function(error){
        return res.status(404).send({
            message: "An error occurred while searching for this movie"
        });
    })



};

function omdbapi(vod_data, callback){

    var api_key = "a421091c"; //todo: dynamic value
    var search_params = "";
    if(vod_data.imdb_id) search_params = search_params+'&'+'i='+vod_data.imdb_id;
    else{
        if(vod_data.vod_title) search_params = search_params+'&'+'t='+vod_data.vod_title;
        if(vod_data.year) search_params = search_params+'&'+'&y='+vod_data.year;
    }

    if(search_params !== ""){
        var options = {
            url: 'http://www.omdbapi.com/?apikey='+api_key+search_params,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        };

        request(options, function (error, response, body) {
            if(error){

                callback(true, "An error occurred while trying to get this movie's data");
            }
            else try {
                var vod_data = {
                    title: JSON.parse(response.body).Title,
                    imdb_id: JSON.parse(response.body).imdbID,
                    //category: JSON.parse(response.body).Genre, //todo:get categories list, match them with our list
                    description: JSON.parse(response.body).Plot,
                    year: JSON.parse(response.body).Year,
                    //icon_url: JSON.parse(response.body).Poster, //todo: check if url is valid. donwload + resize image. if successful, pass new filename as param
                    rate: parseInt(JSON.parse(response.body).imdbRating),
                    duration: JSON.parse(response.body).Runtime.replace(' min', ''),
                    director: JSON.parse(response.body).Director,
                    starring: JSON.parse(response.body).Actors,
                    //pin_protected: (['R', 'X', 'PG-13'].indexOf(JSON.parse(response.body).Rated) !== -1) ? 1 : 0 //todo: will this rate be taken into consideration?
                };
                callback(null, vod_data);
            }
            catch(error){
                callback(true, "Unable to parse response");
            }

        });
    }
    else{
        callback(true, "Unable to find the movie specified by your keywords");
    }

}
