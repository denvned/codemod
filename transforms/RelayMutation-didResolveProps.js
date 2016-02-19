import {init, equalTo, getRequireCall} from '../utils';

const NEW_METHOD_NAME = 'didReceiveProps';

module.exports = (file, api, options) => {
  init(api);

  const j = api.jscodeshift;
  const printOptions = options.printOptions || {quote: 'single'};
  const root = j(file.source);

  function transformMutations(superClass) {
    function isMutationConstructor(path) {
      return j.match(path.parent.parent.value, { superClass });
    }

    function isConstructorTransformable(path) {
      function reportSkipped(reason) {
        const fileName = file.path;
        const {line, column} = path.value.loc.start;
        console.warn(`Mutation skipped in ${fileName} on ${line}:${column}: ${reason}`);
      }

      const func = path.get('value');

      const params = func.get('params').value;
      if (params.length !== 1 || params[0].type !== 'Identifier') {
        reportSkipped('the constructor does not take an identifier as the only argument.');
        return false;
      }

      const propsParamName = params[0].name;

      const statements = func.get('body', 'body');
      const firstStatement = statements.get(0);

      const isSuperCallTheFirst = j.match(firstStatement.value, {
        type: 'ExpressionStatement',
        expression: {
          type: 'CallExpression',
          callee: {
            type: 'Super',
          },
          arguments: equalTo([j.identifier(propsParamName)]),
        },
      });
      if (!isSuperCallTheFirst) {
        reportSkipped(
          `the first statement in the constructor is not \`super(${propsParamName})\`.`
        );
        return false;
      }

      const otherStatements = statements.filter(statement => statement !== firstStatement);
      const propsParamHasMoreReferences =
        !!j(otherStatements).findVariableReference(propsParamName).size();
      if (propsParamHasMoreReferences) {
        reportSkipped('the argument of the constructor is used outside the call to `super`.');
        return false;
      }

      const usesArgumentsObject = !!j(statements).findVariableReference('arguments').size();
      if (usesArgumentsObject) {
        reportSkipped('`arguments` object is used in the constructor.');
        return false;
      }

      return true;
    }

    function transformToDidReceiveProps(path) {
      path.get('kind').replace('method');
      path.get('key', 'name').replace(NEW_METHOD_NAME);
      path.get('value', 'params', 0).prune();
      path.get('value', 'body', 'body', 0).prune();
    }

    return !!root
      .find(j.MethodDefinition, {kind: 'constructor'})
      .filter(isMutationConstructor)
      .filter(isConstructorTransformable)
      .forEach(transformToDidReceiveProps)
      .size();
  }

  let didTransform = false;

  const relayDecl = getRequireCall(root, ['react-relay', 'Relay']);
  if (relayDecl) {
    didTransform = transformMutations({
      type: 'MemberExpression',
      object: {
        type: 'Identifier',
        name: relayDecl.value.id.name,
      },
      property: {
        type: 'Identifier',
        name: 'Mutation',
      },
    }) || didTransform;
  }

  const relayMutationDecl = getRequireCall(root, 'RelayMutation');
  if (relayMutationDecl) {
    didTransform = transformMutations({
      type: 'Identifier',
      name: relayMutationDecl.value.id.name,
    }) || didTransform;
  }

  return didTransform ? root.toSource(printOptions) : null;
};
