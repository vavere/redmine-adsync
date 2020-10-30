const config = require('config');
const got = require('got');

const redmine = config.redmine;

const headers = {'X-Redmine-API-Key': redmine.apiKey};

async function getUsersAll() {
  const activeUsers = await getUsers(1);
  const locketUsers = await getUsers(3);
  return activeUsers.concat(locketUsers);
}

function getUsers(status = 1, seed = [], offset = 0) {
  const limit = 100;
  return getUsersRaw(status, offset, limit)
    .then(users => {
      const result = seed.concat(users);
      if (users.length == limit) {
        return getUsers(status, result, offset + limit);
      } else {
        return result;
      }
  });
}

function getUsersRaw(status, offset, limit) {
  console.log(status, offset, limit)
  return got(`${redmine.endpoint}/users.json?status=${status}&offset=${offset}&limit=${limit}`, {
    json: true,
    headers
  }).then(res => res.body.users);
}


getUsersAll()
.then(users => users.map(u => console.log(u)))