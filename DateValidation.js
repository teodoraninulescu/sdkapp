class DateValidation {


    /**
    * This method validate the dates and
    * return the validated status code and message
    * @param {object} req
    * @param {string} source
    * @returns {Promise}
    */
    async validateManufacturingAndExpiryDate(req, source) {
        let dateValidationStatus = [];
        try {
            switch (source) {
                case Constants.ENT.SHIPMENT:
                    dateValidationStatus = await this.validateShipmentDates(req);
                    break;
                default:
                    break;
            }

            return dateValidationStatus;

        } catch (error) {
            throw new CommonError(Constants.STATUS_CODE.ClientErrorBadRequest, ResourceManager.getText(req, "DATE_VALIDATION_FAILED", [error.message]));
        }
    }

    /**
     * This method get all the details of shipment required for validating
     * the dates like expiry, manufacturing etc.
     * @param {object} req
     * @returns {Promise}
     */
    async validateShipmentDates(req) {
        try {
            // Get Shipment Details
            const shipmentData = await this.dbHelper.selectWithCondition(this.Shipment, { ID: req.params[0].ID });
            const shipmentMaterialData = await this.dbHelper.selectWithCondition(this.ShipmentMaterialDrafts, { parentGUID_ID: req.params[0].ID });
            const shipmentCollectionData = await this.dbHelper.selectWithCondition(this.ShipmentCollection, { shipment_ID: req.params[0].ID });
            const shipmentMaterialPlantData = await this.dbHelper.selectWithCondition(this.MaterialPlant, { plant_id: shipmentData[0].plant_id });

            let processingNodeGuids = [];

            shipmentMaterialData?.forEach((item) => {
                if (item.PROCESSINGNODEGUID_ID !== null) {
                    processingNodeGuids.push(item.PROCESSINGNODEGUID_ID);
                }
            });

            let processingNodeDetailsData = [];

            if (!Utils.isEmptyArray(processingNodeGuids)) {
                processingNodeDetailsData = await this.dbHelper.selectWithCondition(this.ProcessingNodeDetails, {
                    ID: { "in": processingNodeGuids }
                });
            }
            let dateValidationStatus = [];

            // Calculate Shipment Date Validation
            for (const materialItem of shipmentMaterialData) {
                const shipmentMaterialPlantItemData = this.getFilteredEntity(shipmentMaterialPlantData, "material_ID", materialItem.MATERIAL_ID);
                const processingNodeDetailsItemData = this.getFilteredEntity(processingNodeDetailsData, "ID", materialItem.PROCESSINGNODEGUID_ID);
                const shipmentCollectionItemData = this.getFilteredEntity(shipmentCollectionData, "shipmentMaterial_ID", materialItem.additionalReferenceGUID);

                let sourceFieldDate;

                if (shipmentData[0].shipmentType_code === Constants.SHIPMENT_TYPE.BIOSPECIMEN) {
                    sourceFieldDate = this.getSourceFieldDate(shipmentCollectionItemData, shipmentMaterialPlantItemData);
                }

                if (shipmentData[0].shipmentType_code === Constants.SHIPMENT_TYPE.FINISHED_PRODUCT) {
                    sourceFieldDate = this.getSourceFieldDate(processingNodeDetailsItemData, shipmentMaterialPlantItemData);
                }

                const datesObj = {
                    expiryDate: this.calculateDateTimeInMiliseconds(materialItem.BATCHEXPIRYDATE),
                    manufacturingDate: this.calculateDateTimeInMiliseconds(materialItem.BATCHMANUFACTURINGDATE),
                    currentDate: this.calculateDateTimeInMiliseconds(''),
                    sourceFieldDate: sourceFieldDate
                };

                const splitCamelCaseSourceField = this.splitCamelCaseToLowerCase(shipmentMaterialPlantItemData[0].manufacturingDateSource_sourceField);

                dateValidationStatus.push(this.getManufacturingAndExpiryDateValidationStatus(datesObj, materialItem.BATCHNUMBER, splitCamelCaseSourceField, req));
            }

            return Promise.resolve(dateValidationStatus);
        } catch (error) {
            throw error;
        }
    }

    /**
     * This Methods filters the entity based on condition
     * @param {Array} entity
     * @param {string} property
     * @param {string} entityProperty
     * @returns {Array}
     */
    getFilteredEntity(entity, property, entityProperty) {
        return entity.filter(item => item[property] === entityProperty);
    }

    /**
     * This method takes date and return date and time
     * in milliseconds
     * @param {string } date
     * @returns {number}
     */
    calculateDateTimeInMiliseconds(date) {
        return date === '' ? new Date().getTime() : new Date(date).getTime();
    }

    /**
     * This method calculates the source field date
     * @param {Array} sourceField
     * @param {Array} materialPlant
     * @returns {string}
     */
    getSourceFieldDate(sourceField, materialPlant) {
        if (sourceField.length && materialPlant.length) {
            return this.calculateDateTimeInMiliseconds(sourceField[0][materialPlant[0]?.manufacturingDateSource_sourceField]);
        }
    }

    /**
     * This method is used to compare two dates
     * and return if any error
     * @param {object} dateObj
     * @param {string} batchNumber
     * @param {string} sourceField
     * @param {object} req
     * @returns {object}
     */
    getManufacturingAndExpiryDateValidationStatus(dateObj, batchNumber, sourceField, req) {
        const compareDateConditions = [
            {
                condition: {
                    date1: dateObj.expiryDate,
                    date2: dateObj.currentDate
                },
                message: ResourceManager.getText(req, "EXPIRATION_DATE_LESS_THAN_CURRENT_DATE", [batchNumber])
            },
            {
                condition: {
                    date1: dateObj.expiryDate,
                    date2: dateObj.manufacturingDate
                },
                message: ResourceManager.getText(req, "EXPIRATION_DATE_LESS_THAN_MANUFACTURING_DATE", [batchNumber])
            },
            {
                condition: {
                    date1: dateObj.expiryDate,
                    date2: dateObj.sourceFieldDate
                },
                message: ResourceManager.getText(req, "EXPIRATION_DATE_LESS_THAN_SOURCE_FIELD_DATE", [sourceField, batchNumber])
            },
            {
                condition: {
                    date1: dateObj.manufacturingDate,
                    date2: dateObj.sourceFieldDate
                },
                message: ResourceManager.getText(req, "MANUFACTURING_DATE_LESS_THAN_SOURCE_FIELD_DATE", [sourceField, batchNumber])
            }
        ];

        for (let item of compareDateConditions) {
            if (item.condition.date1 > 0 && item.condition.date1 < item.condition.date2) {
                return {
                    statusCode: Constants.STATUS_CODE.ClientErrorBadRequest,
                    message: item.message
                };
            }
        }

        if (dateObj.manufacturingDate > 0 && dateObj.manufacturingDate > dateObj.currentDate) {
            return {
                statusCode: Constants.STATUS_CODE.ClientErrorBadRequest,
                message: ResourceManager.getText(req, "MANUFACTURING__DATE_LESS_THAN_CURRENT_DATE", [batchNumber])
            };
        }

    }

    /**
     * This method splits the camel case text
     * and return in lower case
     * @param {string} text
     * @returns {string}
     */
    splitCamelCaseToLowerCase(text) {
        return text.replace(/([A-Z])/g, " $1").toLowerCase();
    }

}

module.exports = DateValidation;

