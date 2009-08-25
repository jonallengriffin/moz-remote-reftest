import os
from os.path import join
from optparse import OptionParser

def main(dir, reftestFile, crashtestFile):
  print "Beginning Parse for creating manifests in directory: "
  reftest = open(reftestFile, "a")
  crashtest = open(crashtestFile, "a")
  # Make reftests manifest
  for root, dirs, files in os.walk(dir):
    if 'reftest.list' in files:
      reftest.write('include ' + join(root, 'reftest.list') + "\n")
    if 'reftests.list' in files:
      reftest.write('include ' + join(root, 'reftests.list') + "\n")

  for root, dirs, files in os.walk(dir):
    if 'crashtest.list' in files:
      crashtest.write('include ' + join(root, 'crashtest.list') + "\n")
    if 'crashtests.list' in files:
      crashtest.write('include ' + join(root, 'crashtests.list') + "\n")

  reftest.close()
  crashtest.close()


if __name__ == "__main__":
  parser = OptionParser()
  parser.add_option("-d", "--directory", dest="dir", help="directory to parse",
                    metavar="DIR")
  parser.add_option("-r", "--ReftestFile", dest="reftest", help="reftest.list file to create",
                    metavar="REFTEST_FILE")
  parser.add_option("-c", "--CrashtestFile", dest="crashtest", help="crashtests.list file to create",
                    metavar="CRASHTEST_FILE")
  (options, args) = parser.parse_args()
  
  main(options.dir, options.reftest, options.crashtest)
