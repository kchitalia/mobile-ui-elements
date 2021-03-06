(function(SFDC, Force) {

    "use strict";

    var sobjectStores = {};
    var originalSObjectStores = {};

    var generateIndexSpec = function(describeResult, fieldsToIndex) {
        var indexSpecs = [{path: "attributes.type", type: "string"}];
        if (describeResult) {
            describeResult.fields.forEach(function(field) {
                if (field.type == 'reference' || _.contains(fieldsToIndex, field.name)) {
                    var storeType;
                    switch(field.type) {
                        case 'int': storeType = 'integer'; break;
                        case 'double': storeType = 'real'; break;
                        default: storeType = 'string';
                    }
                    indexSpecs.push({
                        path: field.name,
                        type: storeType
                    });
                }
            });
        } else if (fieldsToIndex) { // If describe sobject is not available, just create index on specified fields.
            fieldsToIndex.forEach(function(field) {
                indexspec.push({
                    path: field,
                    type: "string"
                });
            });
        }
        return indexSpecs;
    }

    // Returns either a promise to track store creation progress, or returns the store if ready.
    var createStores = function(sobject, keyField, fieldsToIndex) {
        var dataStore;
        var originalDataStore;
        var that = this;

        // Initiate store cache creation if none initiated already for this sobject
        if (sobject && !sobjectStores[sobject]) {
            var sobjectType = SFDC.getSObjectType(sobject);
            // Initiate store creation of working cache copy based on describe info and fieldstoindex.
            var storePromise = $.when(sobjectType.describe(), fieldsToIndex)
                .then(generateIndexSpec)
                .then(function(indexSpecs) {
                    // Create store based on indexspec
                    dataStore = new Force.StoreCache(sobject, indexSpecs, keyField);
                    // Create store for original copy. No indexspec requird for original copy.
                    originalDataStore = new Force.StoreCache("__" + sobject + "__original", null, keyField);
                    return $.when(dataStore.init(), originalDataStore.init());
                }).then(function() {
                    sobjectStores[sobject] = dataStore;
                    originalSObjectStores[sobject] = originalDataStore;
                    that.fire('store-ready');
                });
            // Capture the store creation promise, until the real store gets assigned.
            // This will prevent creation of same store twice.
            sobjectStores[sobject] = storePromise;
        }
        return sobjectStores[sobject];
    }

    var processName = function(sobject) {
        return typeof sobject === 'string' ? sobject.toLowerCase() : undefined;
    }

    //TBD: Add a property "autoIndex" to generate indexes based on object describe result
    Polymer({
        is: 'force-sobject-store', 
        properties: {

            /**
             * (Required) Type of sobject that you would like to store in this cache.
             *
             * @attribute sobject
             * @type String
             */
            sobject: String,

            /**
             * (Optional) Addition fields (given by their name) that you want to have indexes on.
             * Provide a space delimited list. Also the field names are case sensitive.
             *
             * @attribute fieldstoindex
             * @type String
             * @default null
             */
            fieldstoindex: {
                type: String, /*TBD: Should switch to array */
                value: null
            }
        },
        observers: [
            "init(sobject, fieldstoindex)"
        ],
        // cacheReady: Returns a promise to track store cache creation progress.
        /* TBD: Evaluate moving to computed properties */
        get cacheReady() {
            return this.init();
        },
        // cache: Returns an instance of Force.StoreCache when it's ready to store/retrieve data.
        get cache() {
            var cache = sobjectStores[processName(this.sobject)];
            if (cache instanceof Force.StoreCache) return cache;
        },
        // cacheForOriginals: Returns an instance of Force.StoreCache to be used to keep data copy for conflict resolution.
        get cacheForOriginals() {
            var cache = originalSObjectStores[processName(this.sobject)];
            if (cache instanceof Force.StoreCache) return cache;
        },
        init: function() {
            var that = this;
            var sobject = processName(this.sobject);

            // Create StoreCache if smartstore is available. Also check if sobject is properly set
            if (navigator.smartstore && sobject) {
                var keyField = ((sobject && sobject.indexOf('__x') > 0)
                        ? 'ExternalId' : 'Id');
                var fieldsToIndex = typeof this.fieldstoindex === 'string' ?
                    this.fieldstoindex.trim().split(/\s+/) : [];

                // Create offline stores if launcher is complete
                return SFDC.launcher.then(function() {
                    var storeCreator = createStores.bind(that);
                    return storeCreator(sobject, keyField, fieldsToIndex);
                });
            }
        },
        /**
         * Removes the soup from smartstore. Returns a promise to track the completion of process.
         * 
         * @method destroy
         */
        destroy: function() {
            var cacheDestroy, cacheForOriginalsDestroy;
            var that = this;

            if (this.cache) {
                cacheDestroy = Force.smartstoreClient.removeSoup(this.cache.soupName);
                delete sobjectStores[processName(this.sobject)];
            }
            if (this.cacheForOriginals) {
                cacheForOriginalsDestroy = Force.smartstoreClient.removeSoup(this.cacheForOriginals.soupName);
                delete originalSObjectStores[processName(this.sobject)];
            }
            return $.when(cacheDestroy, cacheForOriginalsDestroy).then(function() {
                // Fire this only when actual remove soup operation has happened
                if (cacheDestroy) that.fire('store-destroy');
            });
        }
    });

}).call(this, window.SFDC, window.Force);
