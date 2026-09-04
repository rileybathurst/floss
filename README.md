# Floss

I'm really bad at backing up my strapi CMS projects so I built a tool to run through them and do an export. It's a little more complex as the node version has to line up.

``` bash
npm start
```

Once everything is exported run another version of floss to pull everything that has just been exported back down

```bash
bash pull.sh
```
