import java.io.PrintWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import javax.lang.model.element.Element;
import javax.lang.model.element.ExecutableElement;
import javax.lang.model.element.TypeElement;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;
import com.sun.source.tree.ClassTree;
import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.TreePath;
import com.sun.source.util.TreePathScanner;
import com.sun.source.util.Trees;

public final class ApertaJavaAnalyzer {
  record SymbolFact(String path, String name, String kind) {}
  record RelationFact(String fromPath, String toPath, String fromName, String toName, String kind) {}

  static String json(String value) {
    if (value == null) return "null";
    return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r") + "\"";
  }

  static String sourcePath(Trees trees, Element element, Path root) {
    if (element == null) return null;
    TreePath path = trees.getPath(element);
    if (path == null || path.getCompilationUnit().getSourceFile() == null) return null;
    try { return root.relativize(Path.of(path.getCompilationUnit().getSourceFile().toUri())).toString().replace('\\', '/'); }
    catch (Exception ignored) { return null; }
  }

  static String symbolName(Element element) {
    if (element == null) return null;
    Element owner = element.getEnclosingElement();
    return owner instanceof TypeElement type ? type.getQualifiedName() + "#" + element.getSimpleName() : element.toString();
  }

  public static void main(String[] args) throws Exception {
    Path root = Path.of(args[0]).toAbsolutePath().normalize();
    String classpath = args.length > 1 ? args[1] : "";
    Set<String> changed = new HashSet<>();
    for (int i = 2; i < args.length; i++) changed.add(args[i].replace('\\', '/'));
    List<Path> files;
    try (var stream = Files.walk(root)) {
      files = stream.filter(path -> path.toString().endsWith(".java"))
        .filter(path -> !path.toString().contains("/target/") && !path.toString().contains("/build/"))
        .limit(750).toList();
    }
    JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
    if (compiler == null) throw new IllegalStateException("JDK compiler unavailable");
    DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
    List<SymbolFact> symbols = new ArrayList<>();
    List<RelationFact> relations = new ArrayList<>();
    Set<String> seenSymbols = new HashSet<>(), seenRelations = new HashSet<>();
    try (StandardJavaFileManager manager = compiler.getStandardFileManager(diagnostics, null, null)) {
      var units = manager.getJavaFileObjectsFromPaths(files);
      var errors = new java.io.StringWriter();
      List<String> options = new ArrayList<>(List.of("-proc:none", "-implicit:none", "-Xlint:none"));
      if (!classpath.isBlank()) { options.add("-classpath"); options.add(classpath); }
      JavacTask task = (JavacTask) compiler.getTask(new PrintWriter(errors), manager, diagnostics, options, null, units);
      Iterable<? extends CompilationUnitTree> parsed = task.parse();
      try { task.analyze(); } catch (Throwable ignored) {}
      Trees trees = Trees.instance(task);
      for (CompilationUnitTree unit : parsed) {
        String unitPath;
        try { unitPath = root.relativize(Path.of(unit.getSourceFile().toUri())).toString().replace('\\', '/'); }
        catch (Exception ignored) { continue; }
        new TreePathScanner<Void, Void>() {
          String currentMethod;
          void addSymbol(Element element, String fallback, String kind) {
            if (!changed.contains(unitPath)) return;
            String name = element instanceof TypeElement type ? type.getQualifiedName().toString() : symbolName(element);
            if (name == null || name.isBlank()) name = fallback;
            String key = unitPath + "|" + name + "|" + kind;
            if (seenSymbols.add(key)) symbols.add(new SymbolFact(unitPath, name, kind));
          }
          @Override public Void visitClass(ClassTree node, Void unused) {
            addSymbol(trees.getElement(getCurrentPath()), node.getSimpleName().toString(), "class");
            return super.visitClass(node, unused);
          }
          @Override public Void visitMethod(MethodTree node, Void unused) {
            String previous = currentMethod;
            Element element = trees.getElement(getCurrentPath());
            currentMethod = symbolName(element);
            if (!node.getName().contentEquals("<init>")) addSymbol(element, node.getName().toString(), "method");
            Void result = super.visitMethod(node, unused);
            currentMethod = previous;
            return result;
          }
          @Override public Void visitMethodInvocation(MethodInvocationTree node, Void unused) {
            TreePath selected = new TreePath(getCurrentPath(), node.getMethodSelect());
            Element target = trees.getElement(selected);
            String targetPath = sourcePath(trees, target, root);
            String targetName = symbolName(target);
            if (targetPath != null && targetName != null && !targetPath.equals(unitPath) && (changed.contains(unitPath) || changed.contains(targetPath))) {
              String key = unitPath + "|" + targetPath + "|" + currentMethod + "|" + targetName;
              if (seenRelations.add(key)) relations.add(new RelationFact(unitPath, targetPath, currentMethod, targetName, "calls"));
            }
            return super.visitMethodInvocation(node, unused);
          }
        }.scan(unit, null);
      }
    }
    long errorCount = diagnostics.getDiagnostics().stream().filter(item -> item.getKind() == Diagnostic.Kind.ERROR).count();
    StringBuilder out = new StringBuilder("{\"provider\":\"java-compiler\",\"diagnostics\":").append(errorCount).append(",\"symbols\":[");
    for (int i = 0; i < symbols.size(); i++) { var item = symbols.get(i); if (i > 0) out.append(','); out.append("{\"path\":").append(json(item.path())).append(",\"name\":").append(json(item.name())).append(",\"kind\":").append(json(item.kind())).append('}'); }
    out.append("],\"relations\":[");
    for (int i = 0; i < relations.size(); i++) { var item = relations.get(i); if (i > 0) out.append(','); out.append("{\"fromPath\":").append(json(item.fromPath())).append(",\"toPath\":").append(json(item.toPath())).append(",\"fromName\":").append(json(item.fromName())).append(",\"toName\":").append(json(item.toName())).append(",\"kind\":\"calls\"}"); }
    out.append("]}");
    System.out.println(out);
  }
}
