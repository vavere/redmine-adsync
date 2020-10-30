const config = require('config');
const got = require('got');

const redmine = config.redmine;

const headers = {'X-Redmine-API-Key': redmine.apiKey};

function getUsers(seed = [], offset = 0) {
  const limit = 100;
  return getUsersRaw(offset, limit)
    .then(users => {
      const result = seed.concat(users);
      if (users.length == limit) {
        return getUsers(result, offset + limit);
      } else {
        return result;
      }
  });
}

function getUsersRaw(offset, limit) {
  console.log(offset, limit)
  return got(`${redmine.endpoint}/users.json?status=1&offset=${offset}&limit=${limit}`, {
    json: true,
    headers
  }).then(res => res.body.users);
}

function getUser(id) {
    return got(`${redmine.endpoint}/users/${id}.json`, {
      json: true,
      headers
    }).then(res => res.body.user);
  }

function lockUser(id) {
    const body = {user: {status: 3}};
    return got.put(`${redmine.endpoint}/users/${id}.json`, {json: true, body, headers})
}

// getUser(1)
// .then(user => console.log(user))
// .then(() => lockUser(158))
// .then(() => getUser(158))
// .then((user) => console.log(user))
// .catch(err => console.error('ERROR', err));

getUsers()
.then(users => users.map(u => console.log(u.id, u.firstname, u.lastname, u.mail)))