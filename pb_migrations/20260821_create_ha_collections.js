/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const ha_entities = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "hidden": false,
        "id": "text_id",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "text_entity_id",
        "name": "entity_id",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "text",
        "unique": true
      },
      {
        "hidden": false,
        "id": "text_domain",
        "name": "domain",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "text_object_id",
        "name": "object_id",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "text_friendly_name",
        "name": "friendly_name",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "text_area_id",
        "name": "area_id",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "text_state",
        "name": "state",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "json_attributes",
        "name": "attributes",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "json"
      },
      {
        "hidden": false,
        "id": "date_last_updated",
        "name": "last_updated",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "date"
      },
      {
        "hidden": false,
        "id": "select_source",
        "name": "source",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "select",
        "values": ["ha","mqtt"]
      }
    ],
    "id": "pbc_ha_entities",
    "indexes": [],
    "listRule": null,
    "name": "ha_entities",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });

  const ha_areas = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "hidden": false,
        "id": "text_id_a",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "text_area_id_a",
        "name": "area_id",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "text",
        "unique": true
      },
      {
        "hidden": false,
        "id": "text_name_a",
        "name": "name",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "text_icon_a",
        "name": "icon",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      }
    ],
    "id": "pbc_ha_areas",
    "indexes": [],
    "listRule": null,
    "name": "ha_areas",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });

  const ha_devices = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "hidden": false,
        "id": "text_id_d",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "text_device_id",
        "name": "device_id",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "text",
        "unique": true
      },
      {
        "hidden": false,
        "id": "text_name_d",
        "name": "name",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "text_manufacturer",
        "name": "manufacturer",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "text_area_id_d",
        "name": "area_id",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      }
    ],
    "id": "pbc_ha_devices",
    "indexes": [],
    "listRule": null,
    "name": "ha_devices",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });

  const ha_automations = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "hidden": false,
        "id": "text_id_auto",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "text_automation_id",
        "name": "automation_id",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "text",
        "unique": true
      },
      {
        "hidden": false,
        "id": "text_name_auto",
        "name": "name",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "text_state_auto",
        "name": "state",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "date_last_triggered",
        "name": "last_triggered",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "date"
      }
    ],
    "id": "pbc_ha_automations",
    "indexes": [],
    "listRule": null,
    "name": "ha_automations",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });

  return Promise.all([
    app.save(ha_entities),
    app.save(ha_areas),
    app.save(ha_devices),
    app.save(ha_automations)
  ]);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("ha_entities"));
  app.delete(app.findCollectionByNameOrId("ha_areas"));
  app.delete(app.findCollectionByNameOrId("ha_devices"));
  app.delete(app.findCollectionByNameOrId("ha_automations"));
});
