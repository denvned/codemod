module.exports = (file, api, options) => {
  const j = api.jscodeshift;
  const printOptions = options.printOptions || {quote: 'single'};
  const root = j(file.source);

  function equalTo(right) {
    return left => j.types.astNodesAreEquivalent(left, right);
  }

  function getRequireCall(path, moduleName) {
    const call = path
      .findVariableDeclarators()
      .filter(j.filters.VariableDeclarator.requiresModule(moduleName));
    return call.size() == 1 ? call.get() : null;
  }

  j.registerMethods({
    findIdentifier(name) {
      return this.find(j.Identifier, {name});
    },
  });

  const COMPUTABLES = [
    { type: j.ClassProperty,    fieldName: 'key' },
    { type: j.MemberExpression, fieldName: 'property' },
    { type: j.MethodDefinition, fieldName: 'key' },
    { type: j.Property,         fieldName: 'key' },
    { type: j.PropertyPattern,  fieldName: 'key' },
  ];

  j.registerMethods({
    findVariableReference(name) {
      function isNodeFieldSupportType(node, fieldName, type) {
        function getNodeTypeDef() {
          const typeDef = j.types.Type.def(node.type);
          if (!typeDef.finalized) {
            throw new Error(`Type '${node.type}' is not finalized.`);
          }

          return typeDef;
        }

        function getNodeFieldType() {
          return getNodeTypeDef().allFields[fieldName].type;
        }

        return getNodeFieldType().check({ type });
      }

      function isVariableReference(path) {
        const parent = path.parent.node;
        const fieldName = path.name;

        if (!isNodeFieldSupportType(parent, fieldName, 'Expression')) {
          return false;
        }

        for (const computable of COMPUTABLES) {
          if (computable.type.check(parent)) {
            return fieldName !== computable.fieldName || parent.computed;
          }
        }

        return true;
      }

      return this.findIdentifier(name).filter(isVariableReference);
    },
  });

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
        reportSkipped(`the constructor does not take an identifier as the only argument.`);
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
        reportSkipped(`the argument of the constructor is used outside the call to \`super\`.`);
        return false;
      }

      const usesArgumentsObject = !!j(statements).findVariableReference('arguments').size();
      if (usesArgumentsObject) {
        reportSkipped(`\`arguments\` object is used in the constructor.`);
        return false;
      }

      return true;
    }

    function transformToDidReceiveProps(path) {
      path.get('kind').replace('method');
      path.get('key', 'name').replace('didReceiveProps');
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

  const relayDecl = getRequireCall(root, ['relay', 'Relay']);
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
