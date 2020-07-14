# Dynamo Entity Manager

A entity manager for AWS Dynamo. It's a class that tracks some entities loaded from dynamo data base (or created to be persisted
in that data base), and that when flushing, it persist the state change in that data base.

### Use cases:

- Helps managing the persistence with the Dynamo API.
- Helps when you want to persist all the changes at once. Ideally the persist should be transactional, but Dynamo does
  not allow it. You have te take care of making the services as small as posible, and managing possible persisting errors.

### Prerequisites

Requires aws-sdk package (if executed in AWS Lambda, it is already installed).
For transactional flush, aws-sdk should be included in your lambda, as installed in cloud is an old version.

```
npm install --save-dev aws-sdk
```

## npm scripts

Build the js files from typescript:

```
npm run build
```

Running tests:

```
npm run test
```

Running style check:

```
npm run style
```

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests to us.

## Versioning

We use [SemVer](http://semver.org/) for versioning. For the versions available, see the tags on this repository.

## Authors

- **Aitor Guerrero** - _Initial work_ - [AitorGuerrero](https://github.com/AitorGuerrero)

## License

This project is licensed under the ISC License - see the [LICENSE.md](LICENSE.md) file for details
