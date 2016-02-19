let j;

export function init(api) {
  j = api.jscodeshift;

  const COMPUTABLES = [
    { type: j.ClassProperty,    fieldName: 'key' },
    { type: j.MemberExpression, fieldName: 'property' },
    { type: j.MethodDefinition, fieldName: 'key' },
    { type: j.Property,         fieldName: 'key' },
    { type: j.PropertyPattern,  fieldName: 'key' },
  ];

  j.registerMethods({
    findIdentifier(name) {
      return this.find(j.Identifier, {name});
    },

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
}

export function equalTo(right) {
  return left => j.types.astNodesAreEquivalent(left, right);
}

export function getRequireCall(path, moduleName) {
  const call = path
    .findVariableDeclarators()
    .filter(j.filters.VariableDeclarator.requiresModule(moduleName));
  return call.size() == 1 ? call.get() : null;
}
