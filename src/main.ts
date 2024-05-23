import axios from "axios";
import path from "node:path";
import fs from "node:fs/promises";
import util from "node:util";
import { faker } from "@faker-js/faker";

const apiKey = "YOUR_POSTMAN_API_KEY";
const postmanBaseUrl = "https://api.getpostman.com";
const swaggerFilePath = path.resolve(__dirname, "../petstore-swagger.json");

interface Swagger {
  servers: { url: string }[];
  paths: { [path: string]: { [method: string]: any } };
  components: { schemas: { [key: string]: any } };
}

// Fetch and parse the Swagger file
const fetchSwagger = async (): Promise<Swagger> => {
  const response = await fs.readFile(swaggerFilePath, "utf-8");
  return JSON.parse(response.toString());
};

const createEnvironment = (serverUrl: string) => ({
  environment: {
    name: new URL(serverUrl).host,
    values: [{ key: "base_url", value: serverUrl, enabled: true }],
  },
});

function hasTypeProperty(obj: any): obj is { type: string; items?: any } {
  return obj && obj.type;
}

// Function to generate fake data based on the schema
const generateFakeData = (schema: any) => {
  const data: any = {};
  for (const [key, value] of Object.entries(schema.properties)) {
    if (!hasTypeProperty(value)) {
      throw new Error(`Type property is missing for ${key}`);
    }

    if (value && value.type === "string") {
      data[key] = faker.commerce.productName();
    } else if (value.type === "integer") {
      data[key] = faker.number.int();
    } else if (value.type === "array" && value.items) {
      data[key] = [generateFakeData(value.items)];
    } else if (value.type === "object") {
      data[key] = generateFakeData(value);
    }
  }
  return data;
};

const createCollection = (swagger: Swagger) => ({
  collection: {
    info: {
      name: "Generated Collection",
      description: "Collection generated from Swagger file",
      schema:
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: Object.entries(swagger.paths).flatMap(([path, methods]) =>
      Object.entries(methods).map(([method, details]) => {
        const bodySchemaRef =
          details.requestBody?.content["application/json"]?.schema?.$ref;
        let body;
        if (bodySchemaRef) {
          const schemaKey = bodySchemaRef.split("/").pop()!;
          const schema = swagger.components.schemas[schemaKey];
          body = {
            mode: "raw",
            raw: JSON.stringify(generateFakeData(schema)),
          };
        }

        const queryParams =
          details.parameters
            ?.filter((param: any) => param.in === "query")
            .map((param: any) => ({
              key: param.name,
              value:
                param.schema.type === "array"
                  ? JSON.stringify([faker.random.word()])
                  : faker.random.word(),
              description: param.description,
            })) || [];

        return {
          name: details.summary || path,
          request: {
            method: method.toUpperCase(),
            header: [],
            url: {
              raw: `{{base_url}}${path}`,
              host: ["{{base_url}}"],
              path: path.split("/").filter(Boolean),
              query: queryParams,
              variable: path.includes("{")
                ? path.match(/{(.*?)}/g)!.map((v: string) => ({
                    key: v.slice(1, -1),
                    value: "",
                    description: "",
                  }))
                : [],
            },
            body: body,
          },
          response: [],
        };
      })
    ),
  },
});

// Helper functions to check if an environment or collection exists
const checkResourceExists = async (resource: string, name: string) => {
  const response = await axios.get(`${postmanBaseUrl}/${resource}`, {
    headers: { "X-Api-Key": apiKey },
  });

  const item = response.data[resource].find((item: any) => item.name === name);
  return item ? item.uid : null;
};

// Helper functions to create or update an environment or collection
const createOrUpdateResource = async (
  resource: string,
  uid: string | null,
  data: any
) => {
  const url = `${postmanBaseUrl}/${resource}${uid ? `/${uid}` : ""}`;
  const method = uid ? "put" : "post";
  await axios[method](url, data, {
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
  });
};

const saveToFile = async (filename: string, data: any) => {
  await fs.writeFile(filename, JSON.stringify(data, null, 2));
};

// Main function to orchestrate the operations
const main = async () => {
  const swagger = await fetchSwagger();

  for (const server of swagger.servers) {
    // TODO: Uncomment if I have a valid key
    // const envUid = await checkResourceExists(
    //   "environments",
    //   new URL(server.url).host
    // );
    const environment = createEnvironment(server.url);
    console.log(util.inspect(environment, { depth: null }));
    // TODO: Uncomment if I have a valid key
    // await createOrUpdateResource("environments", envUid, environment);

    saveToFile(`environment_${new URL(server.url).host}.json`, environment);
  }

  // TODO: Uncomment if I have a valid key
  // const collUid = await checkResourceExists(
  //   "collections",
  //   "Generated Collection"
  // );
  const collection = createCollection(swagger);
  console.log(util.inspect(collection, { depth: null }));

  // TODO: Uncomment if I have a valid key
  // await createOrUpdateResource("collections", collUid, collection);

  saveToFile("collection_generated.json", collection);
  console.log("Environments and Collection created/updated successfully.");
};

main().catch(console.error);
