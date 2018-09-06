# AD lietotāju sinhronizācija ar redmine

Lietotājus sinhronizācija no AD uz Redmine.

## Algoritms

- nolasam AD ierakstus atbilstoši norādītam filtram (ldap/filter)
- no tiem AD ierakstiem, kuriem aizpildīti lauki Vārds, Uzvārds, Epasts, izveidojam jaunu vai salīdzinam ar esošu Redmine lietotāju
- lietotaja unikālitāti nosaka Epasts
- papildus varam aizpildīt Redmine Custom Fields no jebkura AD lauka
- grupējam atlasītos AD lietotājus pēc (redmine/groupby) lauka un izveidojam vai salīdzinam atbilstošas Redmine lietotāju grupas

## Lietošana

```
node index.js [--dry-run]
```

Ja norādīts arguments `--dry-run` tad neveic izmaiņas Redmine

## Konfigurācija

Konfigurācijas fails ir JSON formātā, kur gandrīz katrs lauks ir svarīgs.

### JSON faila piemērs:

```
{
  "redmine": {
    "endpoint": "https://foo.bar.com",
    "apiKey": "eb4783aebe1a124c9acef754...",
    "authId": 1,
    "groupby": "department"
  },
  "ldap": {
    "filter": "(&(objectCategory=user)(memberOf=CN=Users,DC=foo,DC=bar,DC=com))",
    "options": {
      "domainControllers": "XX.XX.XX.XX",
      "searchScope": "dc=foo,dc=bar,dc=lv",
      "root": {
        "dn": "cn=user_name,CN=users,dc=foo,dc=bar,dc=com",
        "password": {
          "crypton": false,
          "value": "abrkadabra"
        }
      }
    }
  }
}
```
